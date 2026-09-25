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

type AudioKit = {
  ctx: AudioContext;
  micAnalyser: AnalyserNode;
  playAnalyser: AnalyserNode;
  micBuf: Uint8Array<ArrayBuffer>;
  playBuf: Uint8Array<ArrayBuffer>;
};

export function createAudio(): AudioEngine {
  // AUDIO-002: the AudioContext and its analysers are created lazily on the
  // first real audio action, so text-only users never pay for a context and
  // no autoplay-policy edge case is triggered before a user gesture.
  let kit: AudioKit | null = null;

  function ensureKit(): AudioKit {
    if (kit) return kit;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor();
    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    const playAnalyser = ctx.createAnalyser();
    playAnalyser.fftSize = 1024;
    playAnalyser.connect(ctx.destination);
    kit = {
      ctx,
      micAnalyser,
      playAnalyser,
      micBuf: new Uint8Array(new ArrayBuffer(micAnalyser.fftSize)),
      playBuf: new Uint8Array(new ArrayBuffer(playAnalyser.fftSize)),
    };
    return kit;
  }

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recording = false;
  let playing = false;
  let playGen = 0;
  // AUDIO-001: scheduling clock shared across streams so back-to-back playback
  // serializes; reset to 0 on Stop/dispose so a later session can never
  // inherit scheduled audio from an earlier one.
  let queueTime = 0;
  // AUDIO-001: cancel handle for the in-flight PCM stream reader, so Stop
  // releases a pending read() instead of waiting for the network.
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // AUDIO-001: every scheduled source is tracked, not just the latest one.
  const activeSources = new Set<AudioBufferSourceNode>();
  let mime = "";
  let deviceId = "";

  async function ensureMic(k: AudioKit): Promise<void> {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    const node = k.ctx.createMediaStreamSource(stream);
    node.connect(k.micAnalyser);
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

  function cancelPendingRead(): void {
    const reader = activeReader;
    activeReader = null;
    if (!reader) return;
    try {
      void Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      /* reader already released */
    }
  }

  function haltPlayback(): void {
    playGen += 1;
    playing = false;
    queueTime = 0;
    cancelPendingRead();
    for (const node of activeSources) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
      node.disconnect();
    }
    activeSources.clear();
  }

  return {
    recording: () => recording,
    async startMic() {
      const k = ensureKit();
      await k.ctx.resume();
      await ensureMic(k);
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
      if (!kit) return 0;
      if (recording) return rms(kit.micAnalyser, kit.micBuf);
      if (playing) return rms(kit.playAnalyser, kit.playBuf);
      return 0;
    },
    stopPlayback() {
      haltPlayback();
    },
    setInput(next) {
      if (next === deviceId) return;
      deviceId = next;
      if (!recording) releaseMic();
    },
    async playPcmStream(body, sampleRate, signal) {
      if (!body) return;
      const k = ensureKit();
      await k.ctx.resume();
      const { ctx, playAnalyser } = k;
      const token = playGen;
      const reader = body.getReader();
      activeReader = reader;
      let pending = new Uint8Array(0);
      let nextTime = Math.max(queueTime, ctx.currentTime + 0.06);
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
        queueTime = nextTime;
        activeSources.add(node);
        node.onended = () => {
          activeSources.delete(node);
          node.disconnect();
        };
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
        if (activeReader === reader) activeReader = null;
        try {
          await reader.cancel();
        } catch {
          /* closed */
        }
        if (token === playGen) playing = false;
      }
    },
    async playMp3(data) {
      const k = ensureKit();
      await k.ctx.resume();
      const { ctx, playAnalyser } = k;
      const token = playGen;
      const audioBuf = await ctx.decodeAudioData(data.slice(0));
      if (token !== playGen) return;
      const node = ctx.createBufferSource();
      node.buffer = audioBuf;
      node.connect(playAnalyser);
      activeSources.add(node);
      playing = true;
      await new Promise<void>((resolve) => {
        node.onended = () => {
          activeSources.delete(node);
          try {
            node.disconnect();
          } catch {
            /* noop */
          }
          if (token === playGen) playing = false;
          resolve();
        };
        node.start();
      });
    },
    dispose() {
      haltPlayback();
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
      if (kit) {
        void kit.ctx.close();
        kit = null;
      }
    },
  };
}
