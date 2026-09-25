// Pure Voice Changer job logic: explicit state machine, quote snapshots,
// file validation and error classification. No React, no DOM, no venice.ts
// imports — this module must stay loadable by `node --experimental-strip-types`
// so the tests can drive it with mocked network functions.

export type QuoteInput = {
  model: string;
  durationSeconds: number;
  voice: string;
  removeNoise: boolean;
  seed: string;
  fileFingerprint: string;
};

export type QuoteSnapshot = {
  input: QuoteInput;
  quote: string;
  quotedAt: number;
};

export type VoiceChangeState =
  | { state: "draft" }
  | { state: "quoted"; quote: QuoteSnapshot }
  | { state: "submitting"; clientAttemptId: string }
  | { state: "submission-unknown"; clientAttemptId: string }
  | { state: "queued"; queueId: string }
  | { state: "processing"; queueId: string }
  | { state: "retrieved"; queueId: string; audio: Blob }
  | { state: "cleanup-pending"; queueId: string; audio?: Blob }
  | { state: "complete"; queueId: string }
  | { state: "failed-before-queue"; reason: string };

export const SUBMISSION_UNKNOWN_WARNING =
  "Queue submission outcome is unknown. Do not retry this take because the original request may have been charged.";

// The browser proxy caps request bodies at 12 MB; stay under it so the
// proxy/provider limits are never hit.
export const LOCAL_MAX_BYTES = 10_000_000;
export const MAX_DURATION_SECONDS = 600;
export const JOBS_STORAGE_KEY = "ember.voice-changer.jobs.v1";
const MAX_JOBS = 20;

export type JobStatus =
  | "active"
  | "processing"
  | "retrieved"
  | "cleanup-unconfirmed"
  | "unknown"
  | "abandoned"
  | "complete";

export type JobRecord = {
  jobId: string;
  queueId: string | null;
  clientAttemptId: string | null;
  model: string;
  voice: string;
  removeNoise: boolean;
  seed: string;
  durationSeconds: number;
  fileName: string;
  fileFingerprint: string;
  quote: string;
  status: JobStatus;
  detail: string;
  createdAt: number;
  updatedAt: number;
};

export function fingerprintFile(file: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function normalizeQuoteInput(raw: {
  model: string;
  durationSeconds: number;
  voice: string;
  removeNoise: boolean;
  seed: string;
  fileFingerprint: string;
}): QuoteInput {
  return {
    model: raw.model.trim(),
    durationSeconds: round1(raw.durationSeconds),
    voice: raw.voice.trim(),
    removeNoise: Boolean(raw.removeNoise),
    seed: raw.seed.trim(),
    fileFingerprint: raw.fileFingerprint,
  };
}

// A quote is valid only while every normalized input exactly matches the
// snapshot taken at quote time. Even fields that may not affect price are
// bound so the queued request can never silently differ from the quote.
export function quoteMatches(snapshot: QuoteInput, current: QuoteInput): boolean {
  return (
    snapshot.model === current.model &&
    snapshot.durationSeconds === current.durationSeconds &&
    snapshot.voice === current.voice &&
    snapshot.removeNoise === current.removeNoise &&
    snapshot.seed === current.seed &&
    snapshot.fileFingerprint === current.fileFingerprint
  );
}

export function validateAudioFileMeta(
  meta: { type: string; size: number },
  maxBytes: number = LOCAL_MAX_BYTES,
): { ok: true } | { ok: false; reason: string } {
  if (!meta.type.startsWith("audio/")) {
    return {
      ok: false,
      reason: `Unsupported file type "${meta.type || "unknown"}". Choose an audio file (audio/*).`,
    };
  }
  if (meta.size > maxBytes) {
    return {
      ok: false,
      reason: `File is ${Math.ceil(meta.size / 1_000_000)} MB; the limit is ${Math.floor(
        maxBytes / 1_000_000,
      )} MB so the upload stays inside the proxy limit.`,
    };
  }
  if (meta.size <= 0) {
    return { ok: false, reason: "That file is empty." };
  }
  return { ok: true };
}

export type QueueFailureKind = "aborted" | "definite" | "ambiguous";

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError"
  );
}

function veniceStatus(err: unknown): number | null {
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "VeniceError"
  ) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

// Venice charges at queue time and forbids retries, so the split below is
// the safety boundary: only errors proving the request was received and
// rejected (a 4xx other than 408) are safe to treat as "not queued".
// Everything else — network drops, 5xx, 408 — is ambiguous and must never
// offer a retry path.
export function classifyQueueError(err: unknown): QueueFailureKind {
  if (isAbortError(err)) return "aborted";
  const status = veniceStatus(err);
  if (status !== null) {
    if (status >= 400 && status < 500 && status !== 408) return "definite";
    return "ambiguous";
  }
  return "ambiguous";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

export type ChangerModelInfo = { id: string; name: string; source: "asr" | "trait" };

// The catalog has no dedicated "voice changer" bucket; changer models are
// resolved from the ASR rows plus any speech-to-speech traits. Returns []
// when the catalog cannot offer a reliable changer list, in which case the
// UI must fall back to its explicit manual override instead of a stale
// hardcoded id.
export function changerModelRows(
  catalog: {
    asr?: { id: string; name?: string }[] | null;
    traits?: Record<string, string> | null;
  } | null,
): ChangerModelInfo[] {
  if (!catalog) return [];
  const out: ChangerModelInfo[] = [];
  const seen = new Set<string>();
  for (const row of catalog.asr ?? []) {
    if (row && typeof row.id === "string" && row.id && !seen.has(row.id)) {
      seen.add(row.id);
      out.push({ id: row.id, name: row.name || row.id, source: "asr" });
    }
  }
  for (const [trait, id] of Object.entries(catalog.traits ?? {})) {
    if (!id || seen.has(id)) continue;
    if (/speech.?to.?speech|voice.?chang|audio.?to.?audio|\bsts\b/i.test(trait)) {
      seen.add(id);
      out.push({ id, name: id, source: "trait" });
    }
  }
  return out;
}

export function formatElapsed(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export type VoiceChangerSnapshot = {
  state: VoiceChangeState;
  inputs: {
    model: string;
    voice: string;
    seed: string;
    removeNoise: boolean;
    durationSeconds: number;
    fileFingerprint: string;
  };
  hasFile: boolean;
  fileName: string;
  fileSize: number;
  lastQuote: QuoteSnapshot | null;
  quoteValid: boolean;
  canQuote: boolean;
  canQueue: boolean;
  busy: boolean;
  cleanupBusy: boolean;
  cleanupConfirmed: boolean;
  cleanupError: string;
  lastError: string;
  newTakeNeedsConfirm: boolean;
  jobs: JobRecord[];
  audio: Blob | null;
  startedAt: number | null;
  lastPollStatus: string;
};

export type VeniceVoiceDeps = {
  quoteVoiceChange: (
    key: string,
    model: string,
    durationSeconds: number,
    signal: AbortSignal,
  ) => Promise<{ quote: string; durationSeconds: number }>;
  queueVoiceChange: (
    key: string,
    input: { model: string; file: File; voice: string; removeNoise: boolean; seed: string },
    signal: AbortSignal,
  ) => Promise<{ queueId: string; status: string; durationSeconds: number }>;
  retrieveVoiceChange: (
    key: string,
    model: string,
    queueId: string,
    signal: AbortSignal,
  ) => Promise<{ status: string; audio: Blob | null }>;
  completeVoiceChange: (
    key: string,
    model: string,
    queueId: string,
    signal: AbortSignal,
  ) => Promise<void>;
};

export type WithKey = <T>(fn: (key: string) => Promise<T>) => Promise<T>;

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type VoiceChangerControllerDeps = {
  withKey: WithKey;
  venice: VeniceVoiceDeps;
  storage?: StorageLike | null;
  now?: () => number;
  newAttemptId?: () => string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  pollAttempts?: number;
  pollIntervalMs?: number;
  maxBytes?: number;
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

type RawInputs = {
  model: string;
  voice: string;
  seed: string;
  removeNoise: boolean;
  durationSeconds: number;
  fileFingerprint: string;
};

function loadJobs(storage: StorageLike | null | undefined): JobRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(JOBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { jobs?: unknown };
    if (!parsed || !Array.isArray(parsed.jobs)) return [];
    return parsed.jobs.filter(
      (job): job is JobRecord =>
        typeof job === "object" &&
        job !== null &&
        typeof (job as JobRecord).jobId === "string" &&
        typeof (job as JobRecord).status === "string",
    );
  } catch {
    return [];
  }
}

export function createVoiceChangerController(deps: VoiceChangerControllerDeps) {
  const now = deps.now ?? (() => Date.now());
  const newAttemptId = deps.newAttemptId ?? (() => Math.random().toString(36).slice(2, 12));
  const sleep = deps.sleep ?? defaultSleep;
  const pollAttempts = deps.pollAttempts ?? 40;
  const pollIntervalMs = deps.pollIntervalMs ?? 1500;
  const maxBytes = deps.maxBytes ?? LOCAL_MAX_BYTES;

  let machine: VoiceChangeState = { state: "draft" };
  let raw: RawInputs = {
    model: "",
    voice: "",
    seed: "",
    removeNoise: true,
    durationSeconds: 0,
    fileFingerprint: "",
  };
  let file: File | null = null;
  let fileName = "";
  let fileSize = 0;
  let hasFile = false;
  let lastQuote: QuoteSnapshot | null = null;
  let jobs: JobRecord[] = loadJobs(deps.storage);
  let audio: Blob | null = null;
  let busyDepth = 0;
  let cleanupBusy = false;
  let cleanupError = "";
  let lastError = "";
  let newTakeNeedsConfirm = false;
  let startedAt: number | null = null;
  let lastPollStatus = "";
  let activeController: AbortController | null = null;

  const listeners = new Set<() => void>();
  let snapshotCache: { version: number; snapshot: VoiceChangerSnapshot } | null = null;
  let version = 0;

  const emit = () => {
    version += 1;
    snapshotCache = null;
    for (const listener of listeners) listener();
  };

  const persistJobs = () => {
    try {
      deps.storage?.setItem(JOBS_STORAGE_KEY, JSON.stringify({ version: 1, jobs }));
    } catch {
      /* storage quota — job memory still lives for this session */
    }
  };

  const upsertJob = (patch: Partial<JobRecord> & { jobId: string }) => {
    const existing = jobs.find((job) => job.jobId === patch.jobId);
    const stamp = now();
    const next: JobRecord = existing
      ? { ...existing, ...patch, updatedAt: stamp }
      : {
          jobId: patch.jobId,
          queueId: patch.queueId ?? null,
          clientAttemptId: patch.clientAttemptId ?? null,
          model: patch.model ?? "",
          voice: patch.voice ?? "",
          removeNoise: patch.removeNoise ?? false,
          seed: patch.seed ?? "",
          durationSeconds: patch.durationSeconds ?? 0,
          fileName: patch.fileName ?? "",
          fileFingerprint: patch.fileFingerprint ?? "",
          quote: patch.quote ?? "",
          status: patch.status ?? "active",
          detail: patch.detail ?? "",
          createdAt: patch.createdAt ?? stamp,
          updatedAt: stamp,
        };
    jobs = [next, ...jobs.filter((job) => job.jobId !== next.jobId)].slice(0, MAX_JOBS);
    persistJobs();
  };

  const jobForQueueId = (queueId: string) => jobs.find((job) => job.queueId === queueId);

  const currentInput = (): QuoteInput =>
    normalizeQuoteInput({
      ...raw,
      fileFingerprint: hasFile ? raw.fileFingerprint : "",
    });

  // Any input edit invalidates a quoted take.
  const inputEdited = () => {
    if (machine.state === "quoted") machine = { state: "draft" };
    newTakeNeedsConfirm = false;
  };

  const snapshot = (): VoiceChangerSnapshot => {
    if (snapshotCache && snapshotCache.version === version) return snapshotCache.snapshot;
    const input = currentInput();
    const quoteValid = lastQuote !== null && hasFile && quoteMatches(lastQuote.input, input);
    const busy = busyDepth > 0;
    const free = !busy && !cleanupBusy;
    const built: VoiceChangerSnapshot = {
      state: machine,
      inputs: { ...raw },
      hasFile,
      fileName,
      fileSize,
      lastQuote,
      quoteValid,
      canQuote:
        free && hasFile && input.durationSeconds > 0 && input.model !== "" && input.voice !== "",
      canQueue: free && machine.state === "quoted" && quoteValid,
      busy,
      cleanupBusy,
      cleanupConfirmed: machine.state === "complete",
      cleanupError,
      lastError,
      newTakeNeedsConfirm,
      jobs,
      audio,
      startedAt,
      lastPollStatus,
    };
    snapshotCache = { version, snapshot: built };
    return built;
  };

  const takeController = () => {
    activeController?.abort();
    const ac = new AbortController();
    activeController = ac;
    return ac;
  };

  const setModel = (value: string) => {
    if (raw.model === value) return;
    raw = { ...raw, model: value };
    inputEdited();
    emit();
  };

  const setVoice = (value: string) => {
    if (raw.voice === value) return;
    raw = { ...raw, voice: value };
    inputEdited();
    emit();
  };

  const setSeed = (value: string) => {
    if (raw.seed === value) return;
    raw = { ...raw, seed: value };
    inputEdited();
    emit();
  };

  const setRemoveNoise = (value: boolean) => {
    if (raw.removeNoise === value) return;
    raw = { ...raw, removeNoise: value };
    inputEdited();
    emit();
  };

  const setDurationSeconds = (value: number) => {
    const next = Number.isFinite(value) ? Math.max(0, round1(value)) : 0;
    if (raw.durationSeconds === next) return;
    raw = { ...raw, durationSeconds: next };
    inputEdited();
    emit();
  };

  // Returns an error reason, or null when the file was accepted.
  const attachFile = (next: File | null): string | null => {
    if (!next) {
      file = null;
      hasFile = false;
      fileName = "";
      fileSize = 0;
      raw = { ...raw, fileFingerprint: "", durationSeconds: 0 };
      inputEdited();
      emit();
      return null;
    }
    const verdict = validateAudioFileMeta({ type: next.type, size: next.size }, maxBytes);
    if (!verdict.ok) {
      lastError = verdict.reason;
      emit();
      return verdict.reason;
    }
    file = next;
    hasFile = true;
    fileName = next.name;
    fileSize = next.size;
    lastError = "";
    cleanupError = "";
    raw = { ...raw, fileFingerprint: fingerprintFile(next), durationSeconds: 0 };
    inputEdited();
    emit();
    return null;
  };

  const quote = async (): Promise<boolean> => {
    if (busyDepth > 0) {
      lastError = "Wait for the current step to finish.";
      emit();
      return false;
    }
    const input = currentInput();
    if (!hasFile || !file) {
      lastError = "Add an audio file first.";
      emit();
      return false;
    }
    if (input.durationSeconds <= 0) {
      lastError = "Duration is required before quoting.";
      emit();
      return false;
    }
    if (!input.model) {
      lastError = "Choose a changer model from the catalog or enter a manual model ID.";
      emit();
      return false;
    }
    if (!input.voice) {
      lastError = "Choose a target voice for the changer model.";
      emit();
      return false;
    }
    busyDepth += 1;
    lastError = "";
    const ac = takeController();
    emit();
    try {
      const found = await deps.withKey((key) =>
        deps.venice.quoteVoiceChange(key, input.model, input.durationSeconds, ac.signal),
      );
      const seconds = round1(found.durationSeconds) || input.durationSeconds;
      raw = { ...raw, durationSeconds: seconds };
      const normalized = normalizeQuoteInput({ ...raw, durationSeconds: seconds });
      lastQuote = {
        input: normalized,
        quote: found.quote || "Quote received.",
        quotedAt: now(),
      };
      machine = { state: "quoted", quote: lastQuote };
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      lastError = errorMessage(err);
      return false;
    } finally {
      busyDepth -= 1;
      if (activeController === ac) activeController = null;
      emit();
    }
  };

  const requestCleanup = async (
    job: JobRecord,
    blob: Blob | null,
    ac: AbortController,
  ): Promise<void> => {
    cleanupBusy = true;
    cleanupError = "";
    if (blob) machine = { state: "cleanup-pending", queueId: job.queueId ?? "", audio: blob };
    emit();
    try {
      await deps.withKey((key) =>
        deps.venice.completeVoiceChange(key, job.model, job.queueId ?? "", ac.signal),
      );
      upsertJob({ ...job, status: "complete", detail: "Cleanup confirmed." });
      if (machine.state === "cleanup-pending" && machine.queueId === job.queueId) {
        machine = { state: "complete", queueId: job.queueId ?? "" };
      }
    } catch (err) {
      cleanupError = isAbortError(err)
        ? "Cleanup was interrupted. Retry cleanup to confirm the media was released."
        : errorMessage(err);
      upsertJob({ ...job, status: "cleanup-unconfirmed", detail: cleanupError });
      if (blob) machine = { state: "cleanup-pending", queueId: job.queueId ?? "", audio: blob };
    } finally {
      cleanupBusy = false;
      emit();
    }
  };

  const poll = async (queueId: string, model: string, ac: AbortController): Promise<void> => {
    machine = { state: "processing", queueId };
    emit();
    for (let attempt = 0; attempt < pollAttempts; attempt++) {
      if (ac.signal.aborted) return;
      lastPollStatus = "Checking…";
      emit();
      try {
        const found = await deps.withKey((key) =>
          deps.venice.retrieveVoiceChange(key, model, queueId, ac.signal),
        );
        if (ac.signal.aborted) return;
        if (found.audio) {
          audio = found.audio;
          lastPollStatus = "Audio ready.";
          const job = jobForQueueId(queueId);
          if (job) upsertJob({ ...job, status: "retrieved", detail: "Audio retrieved." });
          machine = { state: "retrieved", queueId, audio: found.audio };
          emit();
          await requestCleanup(
            job ?? {
              jobId: newAttemptId(),
              queueId,
              clientAttemptId: null,
              model,
              voice: raw.voice.trim(),
              removeNoise: raw.removeNoise,
              seed: raw.seed.trim(),
              durationSeconds: raw.durationSeconds,
              fileName,
              fileFingerprint: raw.fileFingerprint,
              quote: lastQuote?.quote ?? "",
              status: "retrieved",
              detail: "",
              createdAt: now(),
              updatedAt: now(),
            },
            found.audio,
            ac,
          );
          return;
        }
        lastPollStatus = found.status || "Processing…";
        const job = jobForQueueId(queueId);
        if (job) upsertJob({ ...job, status: "processing", detail: lastPollStatus });
        emit();
      } catch (err) {
        if (isAbortError(err)) return;
        lastPollStatus = "";
        lastError = errorMessage(err);
        emit();
        return;
      }
      try {
        await sleep(pollIntervalMs, ac.signal);
      } catch (err) {
        if (isAbortError(err)) return;
        lastError = errorMessage(err);
        emit();
        return;
      }
    }
  };

  const queue = async (): Promise<boolean> => {
    if (busyDepth > 0) {
      lastError = "Wait for the current step to finish.";
      emit();
      return false;
    }
    if (machine.state === "submission-unknown") {
      lastError = SUBMISSION_UNKNOWN_WARNING;
      emit();
      return false;
    }
    if (machine.state !== "quoted" || !lastQuote) {
      lastError = "Quote this take before queueing.";
      emit();
      return false;
    }
    if (!hasFile || !file) {
      lastError = "Add an audio file first.";
      emit();
      return false;
    }
    const attachedFile = file;
    if (!quoteMatches(lastQuote.input, currentInput())) {
      machine = { state: "draft" };
      lastError = "Inputs changed since the quote. Quote again before queueing.";
      emit();
      return false;
    }
    const input = lastQuote.input;
    const attemptId = newAttemptId();
    busyDepth += 1;
    lastError = "";
    const ac = takeController();
    machine = { state: "submitting", clientAttemptId: attemptId };
    startedAt = now();
    lastPollStatus = "";
    emit();
    try {
      const job = await deps.withKey((key) =>
        deps.venice.queueVoiceChange(
          key,
          {
            model: input.model,
            file: attachedFile,
            voice: input.voice,
            removeNoise: input.removeNoise,
            seed: input.seed,
          },
          ac.signal,
        ),
      );
      const record: JobRecord = {
        jobId: attemptId,
        queueId: job.queueId,
        clientAttemptId: attemptId,
        model: input.model,
        voice: input.voice,
        removeNoise: input.removeNoise,
        seed: input.seed,
        durationSeconds: input.durationSeconds,
        fileName,
        fileFingerprint: input.fileFingerprint,
        quote: lastQuote.quote,
        status: "active",
        detail: job.status || "QUEUED",
        createdAt: now(),
        updatedAt: now(),
      };
      upsertJob(record);
      machine = { state: "queued", queueId: job.queueId };
      emit();
      await poll(job.queueId, input.model, ac);
      return true;
    } catch (err) {
      if (classifyQueueError(err) === "definite") {
        machine = { state: "failed-before-queue", reason: errorMessage(err) };
        return false;
      }
      // Ambiguous (network drop, 5xx, 408) or interrupted mid-submit: the
      // request may have reached Venice and been charged. There is
      // deliberately no path back to a Queue button from here.
      upsertJob({
        jobId: attemptId,
        queueId: null,
        clientAttemptId: attemptId,
        model: input.model,
        voice: input.voice,
        removeNoise: input.removeNoise,
        seed: input.seed,
        durationSeconds: input.durationSeconds,
        fileName,
        fileFingerprint: input.fileFingerprint,
        quote: lastQuote.quote,
        status: "unknown",
        detail: SUBMISSION_UNKNOWN_WARNING,
        createdAt: now(),
        updatedAt: now(),
      });
      machine = { state: "submission-unknown", clientAttemptId: attemptId };
      lastError = SUBMISSION_UNKNOWN_WARNING;
      return false;
    } finally {
      busyDepth -= 1;
      if (activeController === ac) activeController = null;
      emit();
    }
  };

  const retryCleanup = async (jobId?: string): Promise<boolean> => {
    const target = jobId
      ? jobs.find((job) => job.jobId === jobId)
      : machine.state === "cleanup-pending"
        ? jobForQueueId(machine.queueId)
        : undefined;
    if (!target || !target.queueId) {
      cleanupError = "Nothing to clean up for this job.";
      emit();
      return false;
    }
    const queueId = target.queueId;
    cleanupBusy = true;
    cleanupError = "";
    emit();
    const ac = takeController();
    try {
      await deps.withKey((key) =>
        deps.venice.completeVoiceChange(key, target.model, queueId, ac.signal),
      );
      upsertJob({ ...target, status: "complete", detail: "Cleanup confirmed." });
      if (
        (machine.state === "cleanup-pending" || machine.state === "processing") &&
        machine.queueId === queueId
      ) {
        machine = { state: "complete", queueId };
      }
      return true;
    } catch (err) {
      cleanupError = isAbortError(err)
        ? "Cleanup was interrupted. Retry cleanup to confirm the media was released."
        : errorMessage(err);
      upsertJob({ ...target, status: "cleanup-unconfirmed", detail: cleanupError });
      return false;
    } finally {
      cleanupBusy = false;
      if (activeController === ac) activeController = null;
      emit();
    }
  };

  const resume = async (jobId: string): Promise<void> => {
    const job = jobs.find((item) => item.jobId === jobId);
    if (!job?.queueId) return;
    if (busyDepth > 0) return;
    busyDepth += 1;
    lastError = "";
    const ac = takeController();
    if (startedAt === null) startedAt = job.createdAt;
    emit();
    try {
      await poll(job.queueId, job.model, ac);
    } finally {
      busyDepth -= 1;
      if (activeController === ac) activeController = null;
      emit();
    }
  };

  const requestNewTake = () => {
    const needsConfirm =
      machine.state === "queued" ||
      machine.state === "processing" ||
      machine.state === "retrieved" ||
      machine.state === "cleanup-pending" ||
      machine.state === "submission-unknown";
    if (busyDepth > 0 || cleanupBusy) return;
    if (!needsConfirm) {
      // Nothing remote to orphan — reset directly, no confirmation needed.
      confirmNewTake();
      return;
    }
    newTakeNeedsConfirm = true;
    emit();
  };

  const confirmNewTake = () => {
    if (machine.state === "queued" || machine.state === "processing") {
      const job = jobForQueueId(machine.queueId);
      if (job) {
        upsertJob({
          ...job,
          status: "abandoned",
          detail:
            "Take abandoned before retrieval. Retry cleanup to release the remote media if the job finished.",
        });
      }
    } else if (machine.state === "retrieved" || machine.state === "cleanup-pending") {
      const job = jobForQueueId(machine.queueId);
      if (job) {
        upsertJob({
          ...job,
          status: "cleanup-unconfirmed",
          detail: "Cleanup not confirmed before starting a new take.",
        });
      }
    }
    machine = { state: "draft" };
    file = null;
    hasFile = false;
    fileName = "";
    fileSize = 0;
    audio = null;
    lastQuote = null;
    startedAt = null;
    lastPollStatus = "";
    cleanupError = "";
    lastError = "";
    newTakeNeedsConfirm = false;
    raw = { ...raw, fileFingerprint: "", durationSeconds: 0 };
    emit();
  };

  const cancelNewTake = () => {
    newTakeNeedsConfirm = false;
    emit();
  };

  // Local abort only: stops in-flight HTTP and polling. It never cancels the
  // remote job — an aborted poll leaves the job queued/processing so it can
  // be resumed, and busy always clears because every op unwinds in finally.
  const abortInFlight = () => {
    activeController?.abort();
    activeController = null;
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): VoiceChangerSnapshot {
      return snapshot();
    },
    setModel,
    setVoice,
    setSeed,
    setRemoveNoise,
    setDurationSeconds,
    attachFile,
    quote,
    queue,
    retryCleanup,
    resume,
    requestNewTake,
    confirmNewTake,
    cancelNewTake,
    abortInFlight,
  };
}

export type VoiceChangerController = ReturnType<typeof createVoiceChangerController>;
