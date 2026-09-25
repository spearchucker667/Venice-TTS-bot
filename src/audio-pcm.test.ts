import assert from "node:assert/strict";
import test from "node:test";
import { createAudio } from "./audio.ts";

// Dependency-free WebAudio mocks (node --experimental-strip-types: no enums,
// no namespaces, no parameter properties — erasable syntax only).
class MockAnalyserNode {
  fftSize = 2048;
  connectCalls = 0;
  disconnectCalls = 0;

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  getByteTimeDomainData(_buf: Uint8Array): void {}
}

class MockAudioBuffer {
  numberOfChannels = 0;
  length = 0;
  sampleRate = 0;
  duration = 0;
  channelData = new Float32Array(0);

  getChannelData(_channel: number): Float32Array {
    return this.channelData;
  }
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connectCalls = 0;
  disconnectCalls = 0;
  stopCalls = 0;
  readonly startTimes: number[] = [];

  connect(_dest: unknown): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  start(when = 0): void {
    this.startTimes.push(when);
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

class MockAudioContext {
  static readonly instances: MockAudioContext[] = [];

  currentTime = 0;
  readonly destination = { kind: "destination" };
  readonly analysers: MockAnalyserNode[] = [];
  readonly buffers: MockAudioBuffer[] = [];
  readonly sources: MockAudioBufferSourceNode[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  constructor() {
    MockAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }

  createAnalyser(): MockAnalyserNode {
    const node = new MockAnalyserNode();
    this.analysers.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MockAudioBuffer {
    const buffer = new MockAudioBuffer();
    buffer.numberOfChannels = numberOfChannels;
    buffer.length = length;
    buffer.sampleRate = sampleRate;
    buffer.duration = length / sampleRate;
    buffer.channelData = new Float32Array(length);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): MockAudioBufferSourceNode {
    const node = new MockAudioBufferSourceNode();
    this.sources.push(node);
    return node;
  }

  createMediaStreamSource(): { connect(): void } {
    return {
      connect() {},
    };
  }

  decodeAudioData(): Promise<MockAudioBuffer> {
    return Promise.resolve(new MockAudioBuffer());
  }
}

function installWindow(): void {
  const fakeWindow = {
    AudioContext: MockAudioContext,
    setTimeout: (fn: (...args: unknown[]) => void, ms: number) => setTimeout(fn, ms),
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
}

// 16-bit mono PCM, little-endian silence: `samples` samples = `samples * 2` bytes.
function pcmChunk(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

test("AUDIO-001: stopPlayback stops and disconnects every scheduled PCM source", async () => {
  installWindow();
  MockAudioContext.instances.length = 0;
  const engine = createAudio();
  const signal = new AbortController().signal;

  await engine.playPcmStream(
    streamOf([pcmChunk(2400), pcmChunk(2400), pcmChunk(2400)]),
    48000,
    signal,
  );

  const ctx = MockAudioContext.instances[0];
  assert.equal(ctx.sources.length, 3, "three PCM chunks should schedule three sources");
  for (const source of ctx.sources) {
    assert.equal(source.startTimes.length, 1, "each source is scheduled exactly once");
    assert.equal(source.stopCalls, 0);
    assert.equal(source.disconnectCalls, 0);
  }
  const firstStart = ctx.sources[0].startTimes[0];
  assert.ok(Math.abs(firstStart - 0.06) < 1e-6, "first buffer starts at currentTime + 0.06");

  engine.stopPlayback();

  for (const source of ctx.sources) {
    assert.equal(source.stopCalls, 1, "every scheduled source receives stop()");
    assert.equal(source.disconnectCalls, 1, "every scheduled source is disconnected");
  }
});

test("AUDIO-001: a second playback after stop does not inherit the first session's schedule", async () => {
  installWindow();
  MockAudioContext.instances.length = 0;
  const engine = createAudio();
  const signal = new AbortController().signal;

  await engine.playPcmStream(
    streamOf([pcmChunk(2400), pcmChunk(2400), pcmChunk(2400)]),
    48000,
    signal,
  );

  const ctx = MockAudioContext.instances[0];
  assert.equal(ctx.sources.length, 3);
  const firstStart = ctx.sources[0].startTimes[0];
  const lastStart = ctx.sources[2].startTimes[0];
  assert.ok(lastStart > firstStart + 0.05, "first session queues multiple buffers ahead");

  engine.stopPlayback();

  await engine.playPcmStream(streamOf([pcmChunk(2400)]), 48000, signal);
  assert.equal(ctx.sources.length, 4);
  const secondStart = ctx.sources[3].startTimes[0];
  assert.ok(
    Math.abs(secondStart - firstStart) < 1e-6,
    "second session restarts at currentTime + 0.06 instead of inheriting the queue clock",
  );
});

test("AUDIO-001: stopPlayback cancels a pending stream reader and drains its sources", async () => {
  installWindow();
  MockAudioContext.instances.length = 0;
  const engine = createAudio();

  let cancels = 0;
  const hanging = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcmChunk(2400));
      controller.enqueue(pcmChunk(2400));
      // Deliberately neither closed nor drained further: read #3 stays pending.
    },
    cancel() {
      cancels += 1;
    },
  });

  const done = withTimeout(
    engine.playPcmStream(hanging, 48000, new AbortController().signal),
    3000,
  );
  await waitFor(() => MockAudioContext.instances[0]?.sources.length === 2);
  const ctx = MockAudioContext.instances[0];
  assert.equal(cancels, 0, "stream has not been cancelled while playing");

  engine.stopPlayback();

  await done;
  assert.ok(cancels >= 1, "stopPlayback cancels the in-flight stream reader");
  assert.equal(engine.level(), 0);
  for (const source of ctx.sources) {
    assert.equal(source.stopCalls, 1);
    assert.equal(source.disconnectCalls, 1);
  }
});

test("AUDIO-002: AudioContext is created lazily on the first play action", async () => {
  installWindow();
  MockAudioContext.instances.length = 0;

  const engine = createAudio();
  assert.equal(
    MockAudioContext.instances.length,
    0,
    "createAudio must not construct an AudioContext",
  );
  assert.equal(engine.level(), 0, "level() is 0 before the context exists");
  engine.stopPlayback();
  assert.equal(
    MockAudioContext.instances.length,
    0,
    "stopPlayback must not construct an AudioContext",
  );

  await engine.playPcmStream(streamOf([pcmChunk(2400)]), 48000, new AbortController().signal);
  assert.equal(MockAudioContext.instances.length, 1, "first play action constructs the context");
  assert.equal(MockAudioContext.instances[0].analysers.length, 2);

  engine.stopPlayback();
  engine.dispose();
  assert.equal(MockAudioContext.instances[0].closeCalls, 1, "dispose closes the context");

  const idle = createAudio();
  idle.dispose();
  assert.equal(
    MockAudioContext.instances.length,
    1,
    "dispose without any audio action never needs a context",
  );
});
