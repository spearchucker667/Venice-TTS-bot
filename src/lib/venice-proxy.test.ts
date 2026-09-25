import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  MAX_BODY_BYTES,
  RequestBodyTooLargeError,
  forwardHeaders,
  proxyVenice,
  readBodyWithCap,
  routeBudget,
  trackUpstreamActivity,
  veniceRouteAllowed,
} from "./venice-proxy.server.ts";

test("allows catalog, characters, chat, audio, and voice changer", () => {
  for (const [method, path, search] of [
    ["GET", "/models", "?type=text"],
    ["GET", "/models/traits", ""],
    ["GET", "/models/compatibility_mapping", ""],
    ["GET", "/characters", "?limit=20&search=ember"],
    ["GET", "/characters/ember-guide", ""],
    ["POST", "/chat/completions", ""],
    ["POST", "/audio/speech", ""],
    ["POST", "/audio/voice-changer/quote", ""],
    ["POST", "/audio/voice-changer/queue", ""],
    ["POST", "/audio/voice-changer/retrieve", ""],
    ["POST", "/audio/voice-changer/complete", ""],
  ] as const) {
    assert.equal(veniceRouteAllowed(method, path, search).ok, true, path);
  }
});

test("blocks key creation, open proxies, and unexpected queries", () => {
  assert.equal(veniceRouteAllowed("POST", "/api_keys", "").ok, false);
  assert.equal(veniceRouteAllowed("GET", "/billing/balance", "").ok, false);
  assert.equal(veniceRouteAllowed("POST", "/characters", "").ok, false);
  assert.equal(veniceRouteAllowed("GET", "/chat/completions", "?x=1").ok, false);
  assert.equal(veniceRouteAllowed("PUT", "/models", "").ok, false);
});

test("route budgets differ per upstream route (PROXY-001)", () => {
  const catalog = routeBudget("GET", "/models");
  const traits = routeBudget("GET", "/models/traits");
  const characters = routeBudget("GET", "/characters");
  const stt = routeBudget("POST", "/audio/transcriptions");
  const quote = routeBudget("POST", "/audio/voice-changer/quote");
  const queue = routeBudget("POST", "/audio/voice-changer/queue");
  const retrieve = routeBudget("POST", "/audio/voice-changer/retrieve");
  const chat = routeBudget("POST", "/chat/completions");
  const tts = routeBudget("POST", "/audio/speech");

  assert.equal(catalog.overallMs, 30_000);
  assert.equal(traits.overallMs, 30_000);
  assert.equal(routeBudget("GET", "/models/compatibility_mapping").overallMs, 30_000);
  assert.equal(characters.overallMs, 30_000);
  assert.equal(stt.overallMs, 120_000);
  assert.equal(quote.overallMs, 120_000);
  assert.equal(queue.overallMs, 120_000);
  assert.equal(retrieve.overallMs, 120_000);
  assert.equal(chat.overallMs, 15 * 60_000);
  assert.equal(tts.overallMs, 15 * 60_000);
  assert.equal(chat.inactivityMs, 60_000);
  assert.equal(tts.inactivityMs, 60_000);
  assert.equal(catalog.inactivityMs, null);
  assert.equal(stt.inactivityMs, null);
  assert.ok(chat.overallMs > catalog.overallMs);
  // Anything else keeps the conservative pre-existing default.
  assert.deepEqual(routeBudget("POST", "/augment/search"), {
    overallMs: 90_000,
    inactivityMs: null,
  });
  assert.deepEqual(routeBudget("DELETE", "/models"), { overallMs: 90_000, inactivityMs: null });
});

test("forwards safe provider headers and strips sensitive ones (PROXY-003)", () => {
  const upstream = new Headers();
  upstream.set("Retry-After", "30");
  upstream.set("X-RateLimit-Limit", "100");
  upstream.set("x-ratelimit-remaining", "42");
  upstream.set("x-ratelimit-reset-requests", "20");
  upstream.set("x-rate-limit-reset", "1700000000");
  upstream.set("X-Request-Id", "req-123");
  upstream.set("Request-Id", "req-456");
  upstream.set("Content-Length", "2048");
  upstream.set("Content-Type", "audio/wav");
  upstream.set("Content-Disposition", 'attachment; filename="voice.wav"');
  upstream.set("X-Venice-Balance-USD", "1.25");
  upstream.set("X-Venice-Balance-Diem", "9");
  upstream.set("Authorization", "Bearer upstream-secret");
  upstream.set("Proxy-Authorization", "Basic upstream-secret");
  upstream.set("Set-Cookie", "session=secret");
  upstream.set("Cookie", "session=secret");
  upstream.set("X-Internal-Trace", "internal-only");

  const out = forwardHeaders(upstream);
  assert.equal(out.get("retry-after"), "30");
  assert.equal(out.get("x-ratelimit-limit"), "100");
  assert.equal(out.get("X-RateLimit-Remaining"), "42"); // Headers reads are case-insensitive
  assert.equal(out.get("x-ratelimit-reset-requests"), "20");
  assert.equal(out.get("x-rate-limit-reset"), "1700000000");
  assert.equal(out.get("x-request-id"), "req-123");
  assert.equal(out.get("request-id"), "req-456");
  assert.equal(out.get("content-length"), "2048");
  assert.equal(out.get("content-type"), "audio/wav");
  assert.equal(out.get("content-disposition"), 'attachment; filename="voice.wav"');
  assert.equal(out.get("x-venice-balance-usd"), "1.25");
  assert.equal(out.get("x-venice-balance-diem"), "9");
  assert.equal(out.get("cache-control"), "no-store");
  assert.equal(out.get("authorization"), null);
  assert.equal(out.get("proxy-authorization"), null);
  assert.equal(out.get("set-cookie"), null);
  assert.equal(out.get("cookie"), null);
  assert.equal(out.get("x-internal-trace"), null);
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A stream whose chunks are pushed manually, like a live upstream body. */
function controllableStream(onAbort?: (error: () => void) => void): {
  stream: ReadableStream<Uint8Array>;
  push: (chunk: Uint8Array) => void;
  close: () => void;
  controller: AbortController;
} {
  const controller = new AbortController();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      streamController = c;
      if (onAbort) {
        controller.signal.addEventListener("abort", () => {
          onAbort(() => c.error(new DOMException("The operation was aborted.", "AbortError")));
        });
      }
    },
  });
  return {
    stream,
    push: (chunk) => streamController.enqueue(chunk),
    close: () => streamController.close(),
    controller,
  };
}

test("inactivity watchdog aborts when the upstream stream stalls (PROXY-001)", async () => {
  const upstream = controllableStream((error) => error()); // fetch-like: abort errors the body
  const watched = trackUpstreamActivity(
    upstream.stream,
    40,
    upstream.controller,
    upstream.controller.signal,
  );
  await sleep(150);
  assert.equal(upstream.controller.signal.aborted, true, "watchdog should have fired");
  const reader = watched.getReader();
  const result = await reader.read();
  assert.equal(result.done, true, "client response must end cleanly, not error");
});

test("inactivity watchdog stays quiet while chunks flow (PROXY-001)", async () => {
  const upstream = controllableStream();
  const watched = trackUpstreamActivity(
    upstream.stream,
    120,
    upstream.controller,
    upstream.controller.signal,
  );
  const reader = watched.getReader();
  const received: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    upstream.push(new Uint8Array([i]));
    const result = await reader.read();
    if (result.done) break;
    assert.ok(result.value);
    received.push(result.value[0]);
    await sleep(40); // ~320ms total, well past the 120ms quiet window per chunk
  }
  assert.equal(upstream.controller.signal.aborted, false);
  assert.deepEqual(received, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("upstream abort mid-stream ends the client response cleanly (PROXY-001)", async () => {
  const upstream = controllableStream((error) => error());
  const watched = trackUpstreamActivity(
    upstream.stream,
    60_000,
    upstream.controller,
    upstream.controller.signal,
  );
  const reader = watched.getReader();
  upstream.push(new Uint8Array([1, 2, 3]));
  const first = await reader.read();
  assert.equal(first.done, false);
  upstream.controller.abort();
  const second = await reader.read();
  assert.equal(second.done, true);
});

test("readBodyWithCap enforces the cap during the read (PROXY-002)", async () => {
  const small = new Request("http://local.test/upload", { method: "POST", body: "hello" });
  assert.deepEqual(new Uint8Array(await readBodyWithCap(small)), new TextEncoder().encode("hello"));

  let producedChunks = 0;
  const big = new Request("http://local.test/upload", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        producedChunks += 1;
        c.enqueue(new Uint8Array(1_000_000));
      },
    }),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(() => readBodyWithCap(big, 2_000_000), RequestBodyTooLargeError);
  assert.ok(producedChunks <= 4, `read should stop at the cap, produced ${producedChunks}`);
});

/** Install a mock fetch for the duration of one test. */
function useMockFetch(
  t: TestContext,
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = handler;
}

test("rejects oversize uploads from Content-Length before reading or fetching (PROXY-002)", async (t) => {
  let fetchCalls = 0;
  useMockFetch(t, () => {
    fetchCalls += 1;
    return Promise.resolve(new Response("ok"));
  });
  // An upload stream that never produces: if the proxy tried to buffer the
  // body first, this test would time out instead of returning 413.
  const upload = new ReadableStream<Uint8Array>({ start() {} });
  const request = new Request("http://local.test/api/venice/audio/speech", {
    method: "POST",
    headers: {
      authorization: "Bearer abcdefgh12345678",
      "content-length": String(MAX_BODY_BYTES + 1),
    },
    body: upload,
    duplex: "half",
  } as RequestInit);
  const response = await proxyVenice(request);
  assert.equal(response.status, 413);
  assert.equal(fetchCalls, 0);
  const payload = (await response.json()) as { error: { message: string } };
  assert.match(payload.error.message, /too large/i);
});

test("rejects uploads that exceed the cap mid-read when Content-Length is absent (PROXY-002)", async (t) => {
  let fetchCalls = 0;
  useMockFetch(t, () => {
    fetchCalls += 1;
    return Promise.resolve(new Response("ok"));
  });
  const upload = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1_000_000));
    },
  });
  const request = new Request("http://local.test/api/venice/audio/transcriptions", {
    method: "POST",
    headers: { authorization: "Bearer abcdefgh12345678" },
    body: upload,
    duplex: "half",
  } as RequestInit);
  const response = await proxyVenice(request);
  assert.equal(response.status, 413);
  assert.equal(fetchCalls, 0);
});

test("streams upstream chunks through to the client (PROXY-001, PROXY-003)", async (t) => {
  let capturedInit: RequestInit | undefined;
  useMockFetch(t, (_input, init) => {
    capturedInit = init;
    const parts = ["ab", "cd", "ef"];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index >= parts.length) {
          controller.close();
          return;
        }
        await sleep(15);
        controller.enqueue(new TextEncoder().encode(parts[index]));
        index += 1;
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": "6",
          "x-request-id": "req-stream",
          "set-cookie": "session=secret",
        },
      }),
    );
  });
  const request = new Request("http://local.test/api/venice/audio/speech", {
    method: "POST",
    headers: { authorization: "Bearer abcdefgh12345678", "content-type": "application/json" },
    body: JSON.stringify({ text: "hi" }),
  });
  const response = await proxyVenice(request);
  assert.equal(response.status, 200);
  assert.ok(capturedInit?.signal instanceof AbortSignal);
  const text = await response.text();
  assert.equal(text, "abcdef");
  assert.equal(response.headers.get("x-request-id"), "req-stream");
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("set-cookie"), null);
  // Streamed route: the watchdog may truncate cleanly, so no fixed byte count.
  assert.equal(response.headers.get("content-length"), null);
});

test("client disconnect mid-stream ends the response cleanly (PROXY-001)", async (t) => {
  let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
  useMockFetch(t, (_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("The operation was aborted.", "AbortError"));
        });
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  });
  const client = new AbortController();
  const request = new Request("http://local.test/api/venice/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer abcdefgh12345678", "content-type": "application/json" },
    body: JSON.stringify({ stream: true }),
    signal: client.signal,
  });
  const response = await proxyVenice(request);
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  upstreamController.enqueue(new TextEncoder().encode("data: {}\n\n"));
  const first = await reader.read();
  assert.equal(first.done, false);
  client.abort();
  const second = await reader.read();
  assert.equal(second.done, true);
});

test("scrubs JSON errors on streaming routes without locking the body (PROXY-001, PROXY-003)", async (t) => {
  useMockFetch(t, () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "invalid: abcdefgh12345678" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  const request = new Request("http://local.test/api/venice/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer abcdefgh12345678", "content-type": "application/json" },
    body: JSON.stringify({ stream: true }),
  });
  const response = await proxyVenice(request);
  assert.equal(response.status, 400);
  const raw = await response.text();
  assert.ok(!raw.includes("abcdefgh12345678"));
  const payload = JSON.parse(raw) as { error: { message: string } };
  assert.match(payload.error.message, /invalid: …/);
});

test("scrubs provider errors and keeps useful headers on the error path (PROXY-003)", async (t) => {
  useMockFetch(t, () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "bad key abcdefgh12345678 upstream" } }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "content-length": "9999",
          "x-request-id": "req-err",
          authorization: "Bearer upstream-secret",
        },
      }),
    ),
  );
  const request = new Request("http://local.test/api/venice/models", {
    headers: { authorization: "Bearer abcdefgh12345678" },
  });
  const response = await proxyVenice(request);
  assert.equal(response.status, 401);
  const raw = await response.text();
  assert.ok(!raw.includes("abcdefgh12345678"), "client key must be scrubbed from provider errors");
  const payload = JSON.parse(raw) as { error: { message: string } };
  assert.match(payload.error.message, /bad key … upstream/);
  assert.equal(response.headers.get("x-request-id"), "req-err");
  assert.equal(response.headers.get("authorization"), null);
  // Scrubbed payload length differs from the upstream declaration.
  assert.equal(response.headers.get("content-length"), null);
});

test("forwards content-length on non-streamed pass-through responses (PROXY-003)", async (t) => {
  useMockFetch(t, () =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "11",
          "x-venice-balance-usd": "3.50",
        },
      }),
    ),
  );
  const request = new Request("http://local.test/api/venice/models?type=text", {
    headers: { authorization: "Bearer abcdefgh12345678" },
  });
  const response = await proxyVenice(request);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { data: unknown[] };
  assert.deepEqual(payload.data, []);
  assert.equal(response.headers.get("content-length"), "11");
  assert.equal(response.headers.get("x-venice-balance-usd"), "3.50");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
