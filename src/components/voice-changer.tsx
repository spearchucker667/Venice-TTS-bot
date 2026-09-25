import { useEffect, useMemo, useState } from "react";
import {
  discoverModels,
  loadCatalog,
  modelVoices,
  saveCatalog,
  VeniceError,
  type Discovery,
} from "@/venice";
import {
  changerModelRows,
  formatElapsed,
  LOCAL_MAX_BYTES,
  MAX_DURATION_SECONDS,
  SUBMISSION_UNKNOWN_WARNING,
} from "@/voice-changer-core";
import { useVoiceChanger } from "@/use-voice-changer";

// Props epoch/voices/defaultVoice/withKey/onPlay are the stable contract with
// the studio. The changer model and its target voices are resolved from the
// Venice catalog (ASR rows + speech-to-speech traits) and modelVoices() —
// the TTS `voices`/`defaultVoice` props are intentionally NOT used as Voice
// Changer targets: a TTS voice list is not a changer compatibility list.
export function VoiceChanger({
  open,
  epoch,
  withKey,
  onPlay,
}: {
  open: boolean;
  epoch: number;
  // Accepted for the stable studio contract; intentionally unused — changer
  // target voices come from modelVoices() for the selected changer model,
  // never from the TTS voice list.
  voices: string[];
  defaultVoice: string;
  withKey: <T>(fn: (key: string) => Promise<T>) => Promise<T>;
  onPlay: (blob: Blob) => Promise<void>;
}) {
  const { controller, snapshot } = useVoiceChanger({ epoch, withKey });

  const [catalog, setCatalog] = useState<Discovery | null>(() => loadCatalog());
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [modelChoice, setModelChoice] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [changerVoices, setChangerVoices] = useState<string[]>([]);
  const [voicesBusy, setVoicesBusy] = useState(false);
  const [measureError, setMeasureError] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const rows = useMemo(() => changerModelRows(catalog), [catalog]);
  const catalogUnavailable = rows.length === 0;
  const resolvedModel = manualModel.trim() || modelChoice;

  useEffect(() => {
    controller.setModel(resolvedModel);
  }, [controller, resolvedModel]);

  useEffect(() => {
    if (!resolvedModel) {
      setChangerVoices([]);
      return;
    }
    const ac = new AbortController();
    setVoicesBusy(true);
    withKey((key) => modelVoices(key, resolvedModel, ac.signal))
      .then((list) => {
        if (!ac.signal.aborted) setChangerVoices(list);
      })
      .catch(() => {
        if (!ac.signal.aborted) setChangerVoices([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setVoicesBusy(false);
      });
    return () => ac.abort();
  }, [controller, resolvedModel, withKey]);

  const machine = snapshot.state;
  const jobActive =
    machine.state === "queued" ||
    machine.state === "processing" ||
    machine.state === "retrieved" ||
    machine.state === "cleanup-pending";

  useEffect(() => {
    if (!jobActive || snapshot.startedAt === null) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobActive, snapshot.startedAt]);

  if (!open) return null;

  const refreshCatalog = async () => {
    setCatalogBusy(true);
    setCatalogError("");
    try {
      const found = await withKey((key) => discoverModels(key));
      saveCatalog(found);
      setCatalog(found);
    } catch (err) {
      setCatalogError(err instanceof VeniceError ? err.message : "Catalog refresh failed.");
    } finally {
      setCatalogBusy(false);
    }
  };

  const measure = async (next: File) => {
    setMeasureError("");
    try {
      const ctx = new AudioContext();
      try {
        const buf = await ctx.decodeAudioData(await next.arrayBuffer());
        controller.setDurationSeconds(Math.max(0.1, Math.round(buf.duration * 10) / 10));
      } finally {
        await ctx.close().catch(() => {});
      }
    } catch {
      controller.setDurationSeconds(0);
      setMeasureError("Could not read the duration. Enter it manually before quoting.");
    }
  };

  const pickFile = (next: File | undefined) => {
    if (!next) return;
    const rejected = controller.attachFile(next);
    if (rejected) return;
    void measure(next);
  };

  const saveAudio = () => {
    if (!snapshot.audio) return;
    const url = URL.createObjectURL(snapshot.audio);
    const anchor = document.createElement("a");
    anchor.href = url;
    const ext = snapshot.audio.type.includes("mpeg")
      ? "mp3"
      : snapshot.audio.type.includes("wav")
        ? "wav"
        : snapshot.audio.type.split("/")[1] || "bin";
    anchor.download = `voice-change-${machine.state === "complete" ? machine.queueId : "take"}.${ext}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const currentJobId =
    "queueId" in machine
      ? snapshot.jobs.find((job) => job.queueId === machine.queueId)?.jobId
      : undefined;

  const statusLine = () => {
    switch (machine.state) {
      case "draft":
        if (snapshot.lastQuote && !snapshot.quoteValid) {
          return "Inputs changed since the quote — quote again before queueing.";
        }
        return (
          snapshot.lastError ||
          "Choose audio, then quote before queueing. A queue is charged once and is not retried."
        );
      case "quoted":
        return `Quote ready: ${machine.quote.quote}. Queue once when you want the conversion.`;
      case "submitting":
        return "Queueing once… do not close or retry this take.";
      case "submission-unknown":
        return SUBMISSION_UNKNOWN_WARNING;
      case "queued":
      case "processing":
        return `${snapshot.lastPollStatus || "Queued…"} Elapsed ${formatElapsed(
          snapshot.startedAt === null ? null : nowTick - snapshot.startedAt,
        )}. Checking does not start a new charge.`;
      case "retrieved":
        return "Audio retrieved. Confirming cleanup before playback…";
      case "cleanup-pending":
        return snapshot.cleanupBusy
          ? "Confirming cleanup…"
          : `Cleanup not confirmed. ${snapshot.cleanupError} Retry cleanup before relying on release.`;
      case "complete":
        return "Cleanup confirmed — remote media was released. Play or save below.";
      case "failed-before-queue":
        return `Queue rejected: ${machine.reason}. No queue was created — fix the inputs and quote again.`;
    }
  };

  const canPlayOrSave =
    snapshot.audio !== null &&
    (machine.state === "complete" ||
      machine.state === "cleanup-pending" ||
      machine.state === "retrieved");

  return (
    <section className="group">
      <h3>Voice changer</h3>
      <p className="hint">
        Speech-to-speech, separate from chat. Quote first. Queue is charged once and is never
        retried. Limits: audio files up to {Math.floor(LOCAL_MAX_BYTES / 1_000_000)} MB and{" "}
        {MAX_DURATION_SECONDS}s.
      </p>

      <label className="field">
        <span className="field-label">Changer model</span>
        {catalogUnavailable ? (
          <span className="field-hint">
            No changer-compatible models found in the catalog
            {catalog ? " (no ASR rows)." : " (catalog not loaded)."}{" "}
            <button
              type="button"
              className="link"
              disabled={catalogBusy}
              onClick={() => void refreshCatalog()}
            >
              {catalogBusy ? "Refreshing catalog…" : "Refresh catalog"}
            </button>
          </span>
        ) : null}
        {catalogUnavailable ? null : (
          <input
            suppressHydrationWarning
            list="changer-models"
            value={modelChoice}
            placeholder="Pick a changer model"
            onChange={(event) => setModelChoice(event.target.value)}
          />
        )}
        <datalist id="changer-models">
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </datalist>
      </label>
      <label className="field">
        <span className="field-label">Advanced: manual model ID</span>
        <input
          suppressHydrationWarning
          value={manualModel}
          placeholder={
            catalogUnavailable ? "Required — enter a provider model ID" : "Optional override"
          }
          onChange={(event) => setManualModel(event.target.value)}
        />
      </label>
      {catalogError ? <p className="hint">{catalogError}</p> : null}
      {!resolvedModel ? (
        <p className="hint">
          {catalogUnavailable
            ? "Catalog unavailable — enter a changer model ID manually to continue."
            : "Pick a changer model (or enter a manual model ID) to continue."}
        </p>
      ) : null}

      <label className="field">
        <span className="field-label">Target voice (changer model voice ID)</span>
        <input
          suppressHydrationWarning
          list="changer-voices"
          value={snapshot.inputs.voice}
          placeholder={changerVoices.length ? "Pick a changer voice" : "Provider voice ID"}
          onChange={(event) => controller.setVoice(event.target.value)}
        />
        <datalist id="changer-voices">
          {changerVoices.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <span className="field-hint">
          {voicesBusy
            ? "Loading voices for this model…"
            : changerVoices.length
              ? "Voices resolved from the selected changer model."
              : "No discoverable voices for this model — enter the provider voice ID manually."}
        </span>
      </label>

      <label className="field">
        <span className="field-label">Audio file</span>
        <input
          type="file"
          accept="audio/*"
          aria-label="Audio to change"
          onChange={(event) => {
            pickFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {snapshot.hasFile ? (
          <span className="field-hint">
            {snapshot.fileName} ({Math.ceil(snapshot.fileSize / 1000)} KB)
          </span>
        ) : null}
        {measureError ? <span className="field-hint">{measureError}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">Duration seconds</span>
        <input
          suppressHydrationWarning
          type="number"
          min={0.1}
          max={MAX_DURATION_SECONDS}
          step={0.1}
          value={snapshot.inputs.durationSeconds || ""}
          onChange={(event) => controller.setDurationSeconds(Number(event.target.value))}
        />
      </label>
      <label className="switch-row">
        <span className="field-label">Remove background noise</span>
        <input
          type="checkbox"
          checked={snapshot.inputs.removeNoise}
          onChange={(event) => controller.setRemoveNoise(event.target.checked)}
        />
      </label>
      <label className="field">
        <span className="field-label">Seed, optional</span>
        <input
          suppressHydrationWarning
          value={snapshot.inputs.seed}
          onChange={(event) => controller.setSeed(event.target.value)}
        />
      </label>

      <p className="hint" role="status">
        {statusLine()}
      </p>

      {snapshot.newTakeNeedsConfirm ? (
        <div className="group" role="alertdialog" aria-label="Start a new take?">
          <p className="hint">
            {machine.state === "submission-unknown"
              ? SUBMISSION_UNKNOWN_WARNING
              : "This take still has a remote job whose media is not confirmed released. Starting a new take keeps it in the cleanup queue below so release can be retried."}
          </p>
          <div className="confirm-actions">
            <button type="button" className="ghost" onClick={() => controller.cancelNewTake()}>
              Keep current take
            </button>
            <button type="button" className="primary" onClick={() => controller.confirmNewTake()}>
              Abandon and start new take
            </button>
          </div>
        </div>
      ) : null}

      <div className="confirm-actions">
        <button
          type="button"
          className="primary"
          disabled={!snapshot.canQuote}
          onClick={() => void controller.quote()}
        >
          Quote
        </button>
        {machine.state === "submission-unknown" ? null : (
          <button
            type="button"
            className="ghost"
            disabled={!snapshot.canQueue}
            onClick={() => void controller.queue()}
          >
            Queue once
          </button>
        )}
        {jobActive && !snapshot.busy && currentJobId ? (
          <button
            type="button"
            className="ghost"
            onClick={() => void controller.resume(currentJobId)}
          >
            Check again
          </button>
        ) : null}
        {machine.state === "cleanup-pending" ? (
          <button
            type="button"
            className="ghost"
            disabled={snapshot.cleanupBusy}
            onClick={() => void controller.retryCleanup()}
          >
            Retry cleanup
          </button>
        ) : null}
        {canPlayOrSave ? (
          <>
            <button
              type="button"
              className="ghost"
              onClick={() => snapshot.audio && void onPlay(snapshot.audio)}
            >
              Play
            </button>
            <button type="button" className="ghost" onClick={saveAudio}>
              Save
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="ghost"
          disabled={snapshot.busy || snapshot.cleanupBusy || snapshot.newTakeNeedsConfirm}
          onClick={() => controller.requestNewTake()}
        >
          New take
        </button>
      </div>

      {snapshot.jobs.length ? (
        <div className="group">
          <h4>Recent conversions</h4>
          <ul className="menu-list" style={{ maxHeight: "12rem" }}>
            {snapshot.jobs.map((job) => (
              <li key={job.jobId} className="menu-row">
                <div>
                  <div>
                    {job.fileName || "Audio take"} → {job.model}
                  </div>
                  <p className="hint">
                    {job.voice || "voice?"}
                    {job.removeNoise ? " · denoise" : ""}
                    {job.seed ? ` · seed ${job.seed}` : ""} · {job.durationSeconds}s · {job.status}{" "}
                    · {new Date(job.updatedAt).toLocaleString()}
                  </p>
                  {job.detail ? <p className="hint">{job.detail}</p> : null}
                </div>
                <div className="menu-row-actions">
                  {job.queueId &&
                  (job.status === "cleanup-unconfirmed" ||
                    job.status === "abandoned" ||
                    job.status === "unknown") ? (
                    <button
                      type="button"
                      className="chip"
                      disabled={snapshot.cleanupBusy}
                      onClick={() => void controller.retryCleanup(job.jobId)}
                    >
                      Retry cleanup
                    </button>
                  ) : null}
                  {job.queueId && (job.status === "active" || job.status === "processing") ? (
                    <button
                      type="button"
                      className="chip"
                      disabled={snapshot.busy}
                      onClick={() => void controller.resume(job.jobId)}
                    >
                      Resume polling
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
