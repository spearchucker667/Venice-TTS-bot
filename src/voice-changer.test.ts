import assert from "node:assert/strict";
import test from "node:test";
import {
  abortError,
  changerModelRows,
  classifyQueueError,
  createVoiceChangerController,
  fingerprintFile,
  formatElapsed,
  JOBS_STORAGE_KEY,
  LOCAL_MAX_BYTES,
  normalizeQuoteInput,
  quoteMatches,
  SUBMISSION_UNKNOWN_WARNING,
  validateAudioFileMeta,
  type VeniceVoiceDeps,
  type VoiceChangerController,
} from "./voice-changer-core.ts";

// --- mocks: the venice.ts layer is never imported here, let alone hit -------

function veniceError(status: number, message: string): Error {
  const err = new Error(message);
  err.name = "VeniceError";
  Object.assign(err, { status });
  return err;
}

const audioBlob = () => new Blob(["pcm"], { type: "audio/wav" });

const audioFile = (name = "take.wav", size = 2000, lastModified = 1_700_000_000_000) =>
  new File([new Uint8Array(size)], name, {
    type: "audio/wav",
    lastModified,
  });

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => map,
  };
}

type SetupOptions = {
  venice?: Partial<VeniceVoiceDeps>;
  storage?: ReturnType<typeof memoryStorage> | null;
};

function setup(options: SetupOptions = {}) {
  const calls = { quote: 0, queue: 0, retrieve: 0, complete: 0 };
  const overrides = options.venice ?? {};
  const venice: VeniceVoiceDeps = {
    quoteVoiceChange: async (...args) => {
      calls.quote += 1;
      return overrides.quoteVoiceChange
        ? overrides.quoteVoiceChange(...args)
        : { quote: "$0.02", durationSeconds: 5 };
    },
    queueVoiceChange: async (...args) => {
      calls.queue += 1;
      return overrides.queueVoiceChange
        ? overrides.queueVoiceChange(...args)
        : { queueId: "q-1", status: "QUEUED", durationSeconds: 5 };
    },
    retrieveVoiceChange: async (...args) => {
      calls.retrieve += 1;
      return overrides.retrieveVoiceChange
        ? overrides.retrieveVoiceChange(...args)
        : { status: "PROCESSING", audio: null };
    },
    completeVoiceChange: async (...args) => {
      calls.complete += 1;
      if (overrides.completeVoiceChange) return overrides.completeVoiceChange(...args);
    },
  };
  const storage = options.storage === undefined ? memoryStorage() : options.storage;
  const controller = createVoiceChangerController({
    withKey: (fn) => fn("test-key"),
    venice,
    storage,
    now: () => 1_700_000_000_000,
    newAttemptId: (() => {
      let n = 0;
      return () => `attempt-${++n}`;
    })(),
    sleep: () => Promise.resolve(),
    pollAttempts: 5,
    pollIntervalMs: 0,
  });
  return { controller, calls, storage };
}

async function toQuoted(controller: VoiceChangerController) {
  assert.equal(controller.attachFile(audioFile()), null);
  controller.setModel("changer-x");
  controller.setVoice("voice-a");
  controller.setDurationSeconds(5);
  assert.equal(await controller.quote(), true);
  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "quoted");
  assert.equal(snap.quoteValid, true);
  return snap;
}

// --- pure helpers -----------------------------------------------------------

test("fingerprint binds name, size and lastModified", () => {
  const base = { name: "a.wav", size: 10, lastModified: 5 };
  assert.equal(fingerprintFile(base), "a.wav:10:5");
  assert.notEqual(fingerprintFile({ ...base, size: 11 }), fingerprintFile(base));
  assert.notEqual(fingerprintFile({ ...base, name: "b.wav" }), fingerprintFile(base));
  assert.notEqual(fingerprintFile({ ...base, lastModified: 6 }), fingerprintFile(base));
});

test("quote matching compares normalized inputs exactly", () => {
  const snapshot = normalizeQuoteInput({
    model: "changer-x",
    durationSeconds: 5.04,
    voice: "voice-a",
    removeNoise: true,
    seed: " 7 ",
    fileFingerprint: "f:1:2",
  });
  assert.equal(snapshot.seed, "7");
  assert.equal(snapshot.durationSeconds, 5);
  const current = normalizeQuoteInput({
    model: " changer-x ",
    durationSeconds: 5,
    voice: "voice-a",
    removeNoise: true,
    seed: "7",
    fileFingerprint: "f:1:2",
  });
  assert.equal(quoteMatches(snapshot, current), true);
  for (const patch of [
    { model: "other" },
    { durationSeconds: 6 },
    { voice: "other" },
    { removeNoise: false },
    { seed: "8" },
    { fileFingerprint: "f:2:2" },
  ]) {
    assert.equal(quoteMatches(snapshot, { ...current, ...patch }), false, JSON.stringify(patch));
  }
});

test("file meta validation enforces MIME, empty and local size cap", () => {
  assert.deepEqual(validateAudioFileMeta({ type: "audio/wav", size: 10 }), { ok: true });
  assert.equal(validateAudioFileMeta({ type: "video/mp4", size: 10 }).ok, false);
  assert.equal(validateAudioFileMeta({ type: "", size: 10 }).ok, false);
  assert.equal(validateAudioFileMeta({ type: "audio/wav", size: 0 }).ok, false);
  const verdict = validateAudioFileMeta({ type: "audio/wav", size: LOCAL_MAX_BYTES + 1 });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /10 MB/);
  assert.equal(validateAudioFileMeta({ type: "audio/wav", size: LOCAL_MAX_BYTES }).ok, true);
});

test("queue error classification separates abort, definite and ambiguous", () => {
  assert.equal(classifyQueueError(abortError()), "aborted");
  assert.equal(classifyQueueError(veniceError(400, "bad request")), "definite");
  assert.equal(classifyQueueError(veniceError(422, "quote expired")), "definite");
  assert.equal(classifyQueueError(veniceError(408, "timeout")), "ambiguous");
  assert.equal(classifyQueueError(veniceError(500, "bad gateway")), "ambiguous");
  assert.equal(classifyQueueError(veniceError(502, "bad gateway")), "ambiguous");
  assert.equal(classifyQueueError(new TypeError("fetch failed")), "ambiguous");
});

test("changer model rows come from asr rows and speech-to-speech traits only", () => {
  assert.deepEqual(changerModelRows(null), []);
  assert.deepEqual(changerModelRows({ asr: [], traits: {} }), []);
  const rows = changerModelRows({
    asr: [{ id: "sts-a", name: "STS A" }, { id: "sts-b" }],
    traits: {
      "speech-to-speech": "sts-trait",
      default: "text-model",
      voice_changer: "sts-trait-2",
    },
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ["sts-a", "sts-b", "sts-trait", "sts-trait-2"],
  );
  assert.equal(formatElapsed(null), "0:00");
  assert.equal(formatElapsed(65_000), "1:05");
});

// --- controller flows (venice layer fully mocked) ---------------------------

test("queue success: quote → queue → retrieve → cleanup confirmed", async () => {
  let retrieves = 0;
  const { controller, calls } = setup({
    venice: {
      retrieveVoiceChange: async () => {
        retrieves += 1;
        return retrieves < 2
          ? { status: "PROCESSING", audio: null }
          : { status: "DONE", audio: audioBlob() };
      },
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), true);

  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "complete");
  if (snap.state.state === "complete") {
    assert.equal(snap.state.queueId, "q-1");
  }
  assert.equal(snap.cleanupConfirmed, true);
  assert.equal(snap.cleanupError, "");
  assert.equal(snap.audio?.type, "audio/wav");
  assert.equal(snap.busy, false);
  assert.equal(calls.queue, 1);
  assert.equal(calls.complete, 1);
  assert.equal(snap.jobs.length, 1);
  assert.equal(snap.jobs[0]?.status, "complete");
  assert.equal(snap.jobs[0]?.model, "changer-x");
  assert.equal(snap.jobs[0]?.voice, "voice-a");
  assert.equal(snap.jobs[0]?.queueId, "q-1");
  // Metadata only — a Blob must never be JSON-persisted.
  const persisted = snap.jobs[0] as unknown as Record<string, unknown>;
  assert.equal(persisted.audio, undefined);
});

test("definitely-failed-before-send is recoverable and records no orphan job", async () => {
  let queues = 0;
  const { controller, calls } = setup({
    venice: {
      queueVoiceChange: async () => {
        queues += 1;
        if (queues === 1) throw veniceError(422, "quote expired");
        return { queueId: "q-2", status: "QUEUED", durationSeconds: 5 };
      },
      retrieveVoiceChange: async () => ({ status: "DONE", audio: audioBlob() }),
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), false);

  let snap = controller.getSnapshot();
  assert.equal(snap.state.state, "failed-before-queue");
  if (snap.state.state === "failed-before-queue") {
    assert.equal(snap.state.reason, "quote expired");
  }
  assert.equal(snap.canQueue, false);
  assert.equal(snap.jobs.length, 0, "no remote job exists, so nothing is tracked");

  // Nothing remote to orphan: new take resets directly without a confirm.
  controller.requestNewTake();
  const reset = controller.getSnapshot();
  assert.equal(reset.newTakeNeedsConfirm, false);
  assert.equal(reset.state.state, "draft");
  assert.equal(reset.hasFile, false);

  // The same take can be quoted and queued again.
  assert.equal(controller.attachFile(audioFile()), null);
  controller.setDurationSeconds(5);
  assert.equal(await controller.quote(), true);
  assert.equal(await controller.queue(), true);
  snap = controller.getSnapshot();
  assert.equal(snap.state.state, "complete");
  assert.equal(snap.jobs[0]?.queueId, "q-2");
  assert.equal(calls.queue, 2);
});

test("ambiguous submit goes to submission-unknown with no retry path", async () => {
  const { controller, calls } = setup({
    venice: {
      queueVoiceChange: async () => {
        throw veniceError(500, "bad gateway");
      },
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), false);

  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "submission-unknown");
  assert.equal(snap.canQueue, false, "no Queue button path may survive");
  assert.equal(snap.lastError, SUBMISSION_UNKNOWN_WARNING);
  assert.equal(calls.queue, 1);

  // Even attempting queue again from this state must not re-submit.
  assert.equal(await controller.queue(), false);
  assert.equal(calls.queue, 1, "submission-unknown must never retry the POST");

  // Explicit new take is required, with the warning attached to the record.
  controller.requestNewTake();
  assert.equal(controller.getSnapshot().newTakeNeedsConfirm, true);
  controller.confirmNewTake();
  const after = controller.getSnapshot();
  assert.equal(after.state.state, "draft");
  assert.equal(after.jobs[0]?.status, "unknown");
  assert.equal(after.jobs[0]?.detail, SUBMISSION_UNKNOWN_WARNING);
  assert.match(after.jobs[0]?.detail ?? "", /may have been charged/);
});

test("network drop (non-Venice error) is ambiguous too", async () => {
  const { controller } = setup({
    venice: {
      queueVoiceChange: async () => {
        throw new TypeError("fetch failed");
      },
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), false);
  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "submission-unknown");
  assert.equal(snap.lastError, SUBMISSION_UNKNOWN_WARNING);
});

test("quote snapshot invalidates on every input change", async () => {
  const { controller } = setup();
  await toQuoted(controller);

  const edits: Array<[string, () => void]> = [
    ["voice", () => controller.setVoice("voice-b")],
    ["seed", () => controller.setSeed("42")],
    ["removeNoise", () => controller.setRemoveNoise(false)],
    ["duration", () => controller.setDurationSeconds(6)],
    ["model", () => controller.setModel("changer-y")],
    [
      "file",
      () => {
        controller.attachFile(audioFile("other.wav"));
        controller.setDurationSeconds(5);
      },
    ],
  ];
  for (const [label, edit] of edits) {
    edit();
    const snap = controller.getSnapshot();
    assert.equal(snap.quoteValid, false, `${label} change must invalidate the quote`);
    assert.equal(snap.canQueue, false);
    assert.notEqual(snap.state.state, "quoted");
    assert.equal(await controller.quote(), true, `re-quote after ${label} change`);
    assert.equal(controller.getSnapshot().quoteValid, true);
  }
});

test("retrieve succeeds on the first poll and cleanup confirms", async () => {
  const { controller, calls } = setup({
    venice: {
      retrieveVoiceChange: async () => ({ status: "DONE", audio: audioBlob() }),
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), true);
  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "complete");
  assert.equal(snap.cleanupConfirmed, true);
  assert.equal(snap.audio !== null, true);
  assert.equal(calls.retrieve, 1);
  assert.equal(calls.complete, 1);
});

test("complete failure keeps the job, never claims release, retry cleanup succeeds", async () => {
  let completes = 0;
  const { controller, calls } = setup({
    venice: {
      retrieveVoiceChange: async () => ({ status: "DONE", audio: audioBlob() }),
      completeVoiceChange: async () => {
        completes += 1;
        if (completes === 1) throw veniceError(500, "complete failed");
      },
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), true);

  let snap = controller.getSnapshot();
  assert.equal(snap.state.state, "cleanup-pending");
  assert.equal(snap.cleanupConfirmed, false, "must not claim media was released");
  assert.equal(snap.cleanupError, "complete failed");
  assert.equal(snap.audio !== null, true, "audio stays available for play/save");
  assert.equal(snap.jobs[0]?.status, "cleanup-unconfirmed");
  assert.equal(snap.jobs[0]?.queueId, "q-1");

  assert.equal(await controller.retryCleanup(), true);
  snap = controller.getSnapshot();
  assert.equal(snap.state.state, "complete");
  assert.equal(snap.cleanupConfirmed, true);
  assert.equal(snap.cleanupError, "");
  assert.equal(snap.jobs[0]?.status, "complete");
  assert.equal(calls.complete, 2);
});

test("new take with a live queueId requires confirmation and retains the job", async () => {
  const { controller } = setup({
    venice: {
      retrieveVoiceChange: async () => ({ status: "PROCESSING", audio: null }),
    },
  });
  await toQuoted(controller);
  assert.equal(await controller.queue(), true);
  assert.equal(controller.getSnapshot().state.state, "processing");

  // Polls exhausted (pollAttempts: 5, always PROCESSING) → idle but live.
  assert.equal(controller.getSnapshot().busy, false);
  controller.requestNewTake();
  assert.equal(controller.getSnapshot().newTakeNeedsConfirm, true);
  controller.cancelNewTake();
  assert.equal(controller.getSnapshot().newTakeNeedsConfirm, false);
  assert.equal(controller.getSnapshot().state.state, "processing");

  controller.requestNewTake();
  controller.confirmNewTake();
  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "draft");
  assert.equal(snap.jobs.length, 1);
  assert.equal(snap.jobs[0]?.status, "abandoned");
  assert.equal(snap.jobs[0]?.queueId, "q-1", "queueId is retained for cleanup retry");
  assert.equal(snap.hasFile, false);
  assert.equal(snap.quoteValid, false);

  // Cleanup retry for the retained job still works from the list.
  assert.equal(await controller.retryCleanup(snap.jobs[0]?.jobId), true);
  assert.equal(controller.getSnapshot().jobs[0]?.status, "complete");
});

test("abort clears busy: mid-submit interrupt lands charge-safe, mid-poll keeps the job", async () => {
  // Mid-submit abort: outcome unknown → submission-unknown, busy cleared.
  const submit = setup({
    venice: {
      queueVoiceChange: (key, input, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    },
  });
  await toQuoted(submit.controller);
  const pending = submit.controller.queue();
  assert.equal(submit.controller.getSnapshot().busy, true);
  submit.controller.abortInFlight();
  assert.equal(await pending, false);
  let snap = submit.controller.getSnapshot();
  assert.equal(snap.busy, false);
  assert.equal(snap.state.state, "submission-unknown");

  // Mid-poll abort: local only, remote job untouched and resumable.
  const poll = setup({
    venice: {
      queueVoiceChange: async () => ({ queueId: "q-9", status: "QUEUED", durationSeconds: 5 }),
      retrieveVoiceChange: (key, model, queueId, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(abortError()), { once: true });
        }),
    },
  });
  await toQuoted(poll.controller);
  const polling = poll.controller.queue();
  await Promise.resolve();
  poll.controller.abortInFlight();
  await polling;
  snap = poll.controller.getSnapshot();
  assert.equal(snap.busy, false);
  assert.equal(snap.jobs[0]?.queueId, "q-9");
  assert.match(snap.state.state, /processing|queued|retrieved|cleanup-pending|complete/);
  assert.notEqual(snap.state.state, "failed-before-queue");
});

test("oversized file is rejected before any quote call", async () => {
  const { controller, calls } = setup();
  const big = new File([new Uint8Array(LOCAL_MAX_BYTES + 1)], "big.wav", {
    type: "audio/wav",
  });
  const reason = controller.attachFile(big);
  assert.ok(reason);
  assert.match(reason, /10 MB/);
  const snap = controller.getSnapshot();
  assert.equal(snap.hasFile, false);
  assert.equal(snap.canQuote, false);
  assert.equal(await controller.quote(), false);
  assert.equal(calls.quote, 0, "quote must never fire for a rejected file");
});

test("invalid MIME is rejected before any quote call", async () => {
  const { controller, calls } = setup();
  const reason = controller.attachFile(
    new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" }),
  );
  assert.ok(reason);
  assert.match(reason, /audio/);
  assert.equal(controller.getSnapshot().hasFile, false);
  assert.equal(await controller.quote(), false);
  assert.equal(calls.quote, 0);
});

test("unconfirmed cleanup survives a reload via persisted job metadata", async () => {
  const storage = memoryStorage();
  let completes = 0;
  const first = setup({
    storage,
    venice: {
      retrieveVoiceChange: async () => ({ status: "DONE", audio: audioBlob() }),
      completeVoiceChange: async () => {
        completes += 1;
        throw veniceError(500, "complete failed");
      },
    },
  });
  await toQuoted(first.controller);
  assert.equal(await first.controller.queue(), true);
  assert.equal(first.controller.getSnapshot().jobs[0]?.status, "cleanup-unconfirmed");
  const raw = storage.dump().get(JOBS_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(raw.includes("q-1"), true);
  assert.equal(raw.includes("pcm"), false, "no raw audio in storage");

  // Simulate reload: brand new controller over the same storage.
  const revived = setup({
    storage,
    venice: {
      completeVoiceChange: async () => {
        completes += 1;
        if (completes === 2) throw veniceError(500, "still failing");
      },
    },
  });
  const snap = revived.controller.getSnapshot();
  assert.equal(snap.state.state, "draft");
  assert.equal(snap.jobs[0]?.status, "cleanup-unconfirmed");
  assert.equal(snap.jobs[0]?.queueId, "q-1");

  assert.equal(await revived.controller.retryCleanup(snap.jobs[0]?.jobId), false);
  assert.equal(revived.controller.getSnapshot().jobs[0]?.status, "cleanup-unconfirmed");
  assert.equal(await revived.controller.retryCleanup(snap.jobs[0]?.jobId), true);
  const done = revived.controller.getSnapshot();
  assert.equal(done.jobs[0]?.status, "complete");
  assert.equal(done.cleanupConfirmed, false, "history retry does not fake the current take");
  assert.equal(completes, 3);
});

test("manual duration entry feeds the quote snapshot", async () => {
  const { controller, calls } = setup({
    venice: {
      quoteVoiceChange: async (key, model, durationSeconds) => {
        calls.quote += 1;
        return { quote: "$0.05", durationSeconds };
      },
    },
  });
  controller.attachFile(audioFile());
  controller.setModel("changer-x");
  controller.setVoice("voice-a");
  controller.setDurationSeconds(12.34);
  assert.equal(await controller.quote(), true);
  const snap = controller.getSnapshot();
  assert.equal(snap.state.state, "quoted");
  if (snap.state.state === "quoted") {
    assert.equal(snap.state.quote.input.durationSeconds, 12.3);
  }
  assert.equal(snap.quoteValid, true);
});
