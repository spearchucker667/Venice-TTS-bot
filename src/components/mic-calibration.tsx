import { useCallback, useEffect, useRef, useState } from "react";
import { computeRecommendedThreshold } from "@/vad";

export function MicCalibration({
  currentVad,
  onApplyThreshold,
}: {
  currentVad: number;
  onApplyThreshold: (vad: number) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [liveLevel, setLiveLevel] = useState(0);
  const [recommended, setRecommended] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const stopTesting = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setTesting(false);
    setCalibrating(false);
    setLiveLevel(0);
  }, []);

  const startTesting = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      setTesting(true);

      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = ((data[i] ?? 128) - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / data.length);
        setLiveLevel(rms);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      setTesting(false);
    }
  }, []);

  const runCalibration = useCallback(async () => {
    setCalibrating(true);
    setRecommended(null);
    try {
      const stream =
        streamRef.current ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      streamRef.current = stream;
      const ctx = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const samples: number[] = [];
      const startTime = performance.now();

      const sampleLoop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = ((data[i] ?? 128) - 128) / 128;
          sum += norm * norm;
        }
        samples.push(Math.sqrt(sum / data.length));
        if (performance.now() - startTime < 2000) {
          rafRef.current = requestAnimationFrame(sampleLoop);
        } else {
          const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
          const rec = computeRecommendedThreshold(avg);
          setRecommended(rec);
          setCalibrating(false);
        }
      };
      rafRef.current = requestAnimationFrame(sampleLoop);
    } catch {
      setCalibrating(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTesting();
    };
  }, [stopTesting]);

  const percent = Math.min(100, Math.round(liveLevel * 500));
  const thresholdPercent = Math.min(100, Math.round(currentVad * 500));

  return (
    <div
      className="mic-calibration"
      style={{
        margin: "0.5rem 0",
        padding: "0.6rem",
        borderRadius: "0.5rem",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.4rem",
        }}
      >
        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Mic calibration</span>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button type="button" className="chip" onClick={testing ? stopTesting : startTesting}>
            {testing ? "Stop test" : "Test mic"}
          </button>
          <button type="button" className="chip" disabled={calibrating} onClick={runCalibration}>
            {calibrating ? "Measuring..." : "Calibrate room"}
          </button>
        </div>
      </div>
      {testing || calibrating ? (
        <div style={{ margin: "0.4rem 0" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              marginBottom: "0.2rem",
              opacity: 0.8,
            }}
          >
            <span>Live level: {liveLevel.toFixed(3)}</span>
            <span>Threshold: {currentVad.toFixed(3)}</span>
          </div>
          <div
            style={{
              position: "relative",
              height: "8px",
              background: "rgba(255,255,255,0.1)",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${percent}%`,
                background:
                  liveLevel >= currentVad
                    ? "var(--color-wax, #d4653a)"
                    : "var(--color-gold, #f0c15a)",
                transition: "width 50ms ease",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${thresholdPercent}%`,
                width: "2px",
                background: "#fff",
              }}
              title="Current threshold"
            />
          </div>
        </div>
      ) : null}
      {recommended !== null ? (
        <div
          style={{
            marginTop: "0.4rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.8rem",
          }}
        >
          <span>
            Recommended threshold: <strong>{recommended.toFixed(3)}</strong>
          </span>
          <button
            type="button"
            className="primary"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
            onClick={() => onApplyThreshold(recommended)}
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
