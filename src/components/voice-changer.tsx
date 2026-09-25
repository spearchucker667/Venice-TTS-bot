import { useEffect, useRef, useState } from "react";
import {
  completeVoiceChange,
  quoteVoiceChange,
  queueVoiceChange,
  retrieveVoiceChange,
  VeniceError,
} from "@/venice";

const EXAMPLE_MODEL = "elevenlabs-voice-changer";

export function VoiceChanger({
  open,
  epoch,
  voices,
  defaultVoice,
  withKey,
  onPlay,
}: {
  open: boolean;
  epoch: number;
  voices: string[];
  defaultVoice: string;
  withKey: <T>(fn: (key: string) => Promise<T>) => Promise<T>;
  onPlay: (blob: Blob) => Promise<void>;
}) {
  const [model, setModel] = useState("");
  const [voice, setVoice] = useState(defaultVoice);
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [noise, setNoise] = useState(true);
  const [seed, setSeed] = useState("");
  const [quote, setQuote] = useState("");
  const [status, setStatus] = useState(
    "Choose audio, then quote before queueing. A queue is charged and is not retried.",
  );
  const [busy, setBusy] = useState(false);
  const [queueId, setQueueId] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const queued = useRef(false);

  useEffect(() => {
    abortRef.current?.abort();
    return () => abortRef.current?.abort();
  }, [epoch]);

  useEffect(() => {
    if (!voice && defaultVoice) setVoice(defaultVoice);
  }, [defaultVoice, voice]);

  if (!open) return null;

  const modelId = model.trim() || EXAMPLE_MODEL;

  const measure = async (next: File) => {
    setFile(next);
    setQuote("");
    setQueueId("");
    queued.current = false;
    try {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await next.arrayBuffer());
      await ctx.close();
      setSeconds(Math.max(0.1, Math.round(buf.duration * 10) / 10));
    } catch {
      setSeconds(0);
      setStatus("Could not read the duration. Enter it before quoting.");
    }
  };

  const fail = (err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") return;
    setStatus(
      err instanceof VeniceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Voice changer failed.",
    );
    setBusy(false);
  };

  const quoteTake = async () => {
    if (!file || seconds <= 0) {
      setStatus("Add an audio file and a duration first.");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setStatus("Asking Venice for a quote…");
    try {
      const found = await withKey((key) => quoteVoiceChange(key, modelId, seconds, ac.signal));
      setQuote(found.quote || "Quote received.");
      setSeconds(found.durationSeconds || seconds);
      setStatus("Quote ready. Queue once when you want the conversion.");
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  };

  const poll = async (id: string, ac: AbortController) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (ac.signal.aborted) return;
      const found = await withKey((key) => retrieveVoiceChange(key, modelId, id, ac.signal));
      if (found.audio) {
        setStatus("Playing the changed voice…");
        await withKey((key) => completeVoiceChange(key, modelId, id, ac.signal)).catch(
          () => undefined,
        );
        await onPlay(found.audio);
        setStatus("Done. Media was released. Start a new take to queue again.");
        setBusy(false);
        return;
      }
      setStatus(found.status || "Processing…");
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    setStatus("Still processing. Check again — this does not start a new charge.");
    setBusy(false);
  };

  const queueTake = async () => {
    if (!file || !quote || queued.current || queueId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    queued.current = true;
    setStatus("Queueing once…");
    try {
      const job = await withKey((key) =>
        queueVoiceChange(
          key,
          {
            model: modelId,
            file,
            voice: voice.trim() || defaultVoice || "Aria",
            removeNoise: noise,
            seed,
          },
          ac.signal,
        ),
      );
      setQueueId(job.queueId);
      setStatus(`${job.status}. Waiting for audio…`);
      await poll(job.queueId, ac);
    } catch (err) {
      queued.current = false;
      fail(err);
    }
  };

  return (
    <section className="group">
      <h3>Voice changer</h3>
      <p className="hint">
        Speech-to-speech, separate from chat. Quote first. Queue is charged once and is not
        automatically retried. Blank model uses the documented example {EXAMPLE_MODEL}, not a
        discovered catalog id.
      </p>
      <label className="field">
        <span className="field-label">Changer model</span>
        <input
          suppressHydrationWarning
          value={model}
          placeholder={EXAMPLE_MODEL}
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">Target voice</span>
        <input
          suppressHydrationWarning
          list="changer-voices"
          value={voice}
          onChange={(event) => setVoice(event.target.value)}
        />
        <datalist id="changer-voices">
          {voices.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span className="field-label">Audio file</span>
        <input
          type="file"
          accept="audio/*"
          aria-label="Audio to change"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) void measure(next);
          }}
        />
      </label>
      <label className="field">
        <span className="field-label">Duration seconds</span>
        <input
          suppressHydrationWarning
          type="number"
          min={0.1}
          max={600}
          step={0.1}
          value={seconds || ""}
          onChange={(event) => {
            setSeconds(Number(event.target.value));
            setQuote("");
          }}
        />
      </label>
      <label className="switch-row">
        <span className="field-label">Remove background noise</span>
        <input
          type="checkbox"
          checked={noise}
          onChange={(event) => setNoise(event.target.checked)}
        />
      </label>
      <label className="field">
        <span className="field-label">Seed, optional</span>
        <input
          suppressHydrationWarning
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
        />
      </label>
      <p className="hint">{quote ? `Quote: ${quote}` : status}</p>
      <div className="confirm-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !file}
          onClick={() => void quoteTake()}
        >
          Quote
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || !quote || Boolean(queueId)}
          onClick={() => void queueTake()}
        >
          Queue once
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || !queueId}
          onClick={() => {
            const ac = new AbortController();
            abortRef.current = ac;
            setBusy(true);
            void poll(queueId, ac).catch(fail);
          }}
        >
          Check again
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            abortRef.current?.abort();
            queued.current = false;
            setQueueId("");
            setQuote("");
            setBusy(false);
            setStatus("New take. Quote again before queueing.");
          }}
        >
          New take
        </button>
      </div>
    </section>
  );
}
