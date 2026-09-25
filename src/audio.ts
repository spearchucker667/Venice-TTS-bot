export type AudioEngine = {
  startMic: () => Promise<void>;
  stopMic: () => Promise<Blob | null>;
  cancelMic: () => Promise<void>;
  level: () => number;
  playMp3: (data: ArrayBuffer) => Promise<void>;
  playPcmStream: (
    body: ReadableStream<Uint8Array> | null,
    sampleRate: number,
    signal: AbortSignal,
  ) => Promise<void>;
  stopPlayback: () => void;
  setInput: (deviceId: string) => void;
  dispose: () => void;
  recording: () => boolean;
};

function rms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

let levelReader = (): number => 0;

export function bindLevel(fn: () => number): () => void {
  levelReader = fn;
  return () => {
    if (levelReader === fn) levelReader = () => 0;
  };
}

export function readLevel(): number {
  return levelReader();
}

export function stopTracks(stream: { getTracks(): Array<{ stop(): void }> } | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function createAudio(): AudioEngine {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const micAnalyser = ctx.createAnalyser();
  micAnalyser.fftSize = 1024;
  const playAnalyser = ctx.createAnalyser();
  playAnalyser.fftSize = 1024;
  playAnalyser.connect(ctx.destination);
  const micBuf = new Uint8Array(new ArrayBuffer(micAnalyser.fftSize));
  const playBuf = new Uint8Array(new ArrayBuffer(playAnalyser.fftSize));

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recording = false;
  let playing = false;
  let playGen = 0;
  let source: AudioBufferSourceNode | null = null;
  let mime = "";
  let deviceId = "";

  async function ensureMic(): Promise<void> {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    const node = ctx.createMediaStreamSource(stream);
    node.connect(micAnalyser);
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mime = "audio/webm;codecs=opus";
    else if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
    else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4";
    else mime = "";
  }

  function releaseMic(): void {
    stopTracks(stream);
    stream = null;
  }

  function stopRecorder(discard: boolean): Promise<Blob | null> {
    const rec = recorder;
    recorder = null;
    recording = false;
    if (!rec || rec.state === "inactive") {
      chunks = [];
      releaseMic();
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (blob: Blob | null) => {
        if (settled) return;
        settled = true;
        chunks = [];
        releaseMic();
        resolve(blob);
      };
      rec.onerror = () => finish(null);
      rec.onstop = () => {
        const blob =
          discard || chunks.length === 0
            ? null
            : new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        finish(blob);
      };
      try {
        rec.stop();
      } catch {
        finish(null);
      }
    });
  }

  return {
    recording: () => recording,
    async startMic() {
      await ctx.resume();
      await ensureMic();
      if (recording) return;
      chunks = [];
      recorder = new MediaRecorder(stream as MediaStream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data);
      };
      recorder.start();
      recording = true;
    },
    stopMic: () => stopRecorder(false),
    async cancelMic() {
      await stopRecorder(true);
    },
    level() {
      if (recording) return rms(micAnalyser, micBuf);
      if (playing) return rms(playAnalyser, playBuf);
      return 0;
    },
    stopPlayback() {
      playGen += 1;
      playing = false;
      const current = source;
      source = null;
      try {
        current?.stop();
      } catch {
        /* already stopped */
      }
    },
    setInput(next) {
      if (next === deviceId) return;
      deviceId = next;
      if (!recording) releaseMic();
    },
    async playPcmStream(body, sampleRate, signal) {
      await ctx.resume();
      if (!body) return;
      const token = playGen;
      const reader = body.getReader();
      let pending = new Uint8Array(0);
      let nextTime = ctx.currentTime + 0.06;
      playing = true;
      const play = (bytes: Uint8Array) => {
        if (bytes.byteLength < 2 || token !== playGen) return;
        const samples = Math.floor(bytes.byteLength / 2);
        const audioBuf = ctx.createBuffer(1, samples, sampleRate);
        const channel = audioBuf.getChannelData(0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
        for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
        const node = ctx.createBufferSource();
        node.buffer = audioBuf;
        node.connect(playAnalyser);
        const start = Math.max(nextTime, ctx.currentTime + 0.02);
        node.start(start);
        nextTime = start + audioBuf.duration;
        source = node;
      };
      const take = (minSamples: number) => {
        const even = pending.byteLength - (pending.byteLength % 2);
        if (even < minSamples * 2) return;
        play(pending.slice(0, even));
        pending = new Uint8Array(0);
      };
      try {
        while (token === playGen && !signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          const merged = new Uint8Array(pending.byteLength + value.byteLength);
          merged.set(pending);
          merged.set(value, pending.byteLength);
          pending = merged;
          take(2400);
        }
        take(1);
        const wait = Math.max(0, nextTime - ctx.currentTime);
        if (token === playGen && wait > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, wait * 1000));
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* closed */
        }
        if (token === playGen) playing = false;
      }
    },
    async playMp3(data: ArrayBuffer) {
      await ctx.resume();
      const token = playGen;
      const audioBuf = await ctx.decodeAudioData(data.slice(0));
      if (token !== playGen) return;
      const node = ctx.createBufferSource();
      node.buffer = audioBuf;
      node.connect(playAnalyser);
      source = node;
      playing = true;
      await new Promise<void>((resolve) => {
        node.onended = () => {
          if (token === playGen) playing = false;
          resolve();
        };
        node.start();
      });
    },
    dispose() {
      playGen += 1;
      playing = false;
      try {
        source?.stop();
      } catch {
        /* noop */
      }
      source = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* noop */
        }
      }
      recorder = null;
      recording = false;
      releaseMic();
      void ctx.close();
    },
  };
}
