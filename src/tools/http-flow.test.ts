import assert from "node:assert/strict";
import test from "node:test";
import { runTool, type HttpConfirm, type ToolContext } from "../venice.ts";
import {
  clearSessionGrants,
  grantSessionAccess,
  normalizeIntegration,
  type HttpIntegration,
} from "./integrations.ts";
import { RAW_RESPONSE_MAX } from "./response-budget.ts";

type FetchCall = { url: string; init: RequestInit | undefined };

function fakeFetch(handler: (call: FetchCall) => Response) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ctx(partial: {
  confirm?: (req: HttpConfirm) => Promise<boolean>;
  integrations?: HttpIntegration[];
  onConfirm?: (req: HttpConfirm) => void;
}): ToolContext {
  const ac = new AbortController();
  return {
    key: "",
    signal: ac.signal,
    httpIntegrations: partial.integrations ?? [],
    confirmHttp: (req) => {
      partial.onConfirm?.(req);
      return partial.confirm ? partial.confirm(req) : Promise.resolve(true);
    },
  };
}

function httpCall(args: Record<string, unknown>) {
  return { id: "c1", name: "http_request", arguments: JSON.stringify(args) };
}

test("uncovered read asks the user; decline stops the fetch", async () => {
  clearSessionGrants();
  const fake = fakeFetch(() => jsonResponse({}));
  try {
    const seen: HttpConfirm[] = [];
    const result = await runTool(
      httpCall({ url: "https://api.example.com/v1/items?x=1" }),
      ctx({ confirm: () => Promise.resolve(false), onConfirm: (r) => seen.push(r) }),
    );
    assert.match(result, /declined/);
    assert.equal(fake.calls.length, 0, "fetch must not run after a decline");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.origin, "https://api.example.com");
    assert.equal(seen[0]?.method, "GET");
    assert.equal(seen[0]?.pathname, "/v1/items");
    assert.match(seen[0]?.path ?? "", /\/v1\/items\?x=1/);
    assert.equal(seen[0]?.mutating, false);
  } finally {
    fake.restore();
  }
});

test("approved read fetches and packs an untrusted result", async () => {
  clearSessionGrants();
  const fake = fakeFetch(() => new Response('{"ok":true}', { status: 200 }));
  try {
    const result = await runTool(
      httpCall({ url: "https://api.example.com/v1/items" }),
      ctx({ confirm: () => Promise.resolve(true) }),
    );
    const parsed = JSON.parse(result) as {
      untrusted: boolean;
      truncated: boolean;
      data: { status: number; method: string; host: string; body: string; bytes: number };
    };
    assert.equal(parsed.untrusted, true);
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.data.status, 200);
    assert.equal(parsed.data.method, "GET");
    assert.equal(parsed.data.host, "api.example.com");
    assert.equal(parsed.data.body, '{"ok":true}');
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.init?.credentials, "omit");
  } finally {
    fake.restore();
  }
});

test("reads inside an integration run without asking; method outside the set denies", async () => {
  clearSessionGrants();
  const normalized = normalizeIntegration({
    origin: "https://api.example.com",
    pathPrefix: "/v1",
    methods: ["GET"],
  });
  assert.ok("integration" in normalized);
  const integrations = [normalized.integration];

  const fake = fakeFetch(() => new Response("hi"));
  try {
    const result = await runTool(
      httpCall({ url: "https://api.example.com/v1/items" }),
      ctx({ confirm: () => Promise.reject(new Error("must not ask")), integrations }),
    );
    assert.equal(JSON.parse(result).untrusted, true);
    assert.equal(fake.calls.length, 1);

    const denied = await runTool(
      httpCall({ url: "https://api.example.com/v1/items", method: "DELETE" }),
      ctx({ confirm: () => Promise.resolve(true), integrations }),
    );
    assert.match(denied, /Tool error: Method DELETE is outside the integration scope/);
    assert.equal(fake.calls.length, 1, "denied request must not fetch");
  } finally {
    fake.restore();
  }
});

test("writes always ask, even inside an integration, and send a bounded body preview", async () => {
  clearSessionGrants();
  const normalized = normalizeIntegration({
    origin: "https://api.example.com",
    methods: ["GET", "POST"],
  });
  assert.ok("integration" in normalized);
  const seen: HttpConfirm[] = [];
  const fake = fakeFetch(() => new Response("{}"));
  try {
    await runTool(
      httpCall({ url: "https://api.example.com/v1/run", method: "POST", body: "payload=1" }),
      ctx({
        integrations: [normalized.integration],
        confirm: (req) => {
          seen.push(req);
          return Promise.resolve(true);
        },
      }),
    );
    assert.equal(seen.length, 1, "write inside an integration still asks");
    assert.equal(seen[0]?.mutating, true);
    assert.equal(seen[0]?.bodyPreview, "payload=1");
    assert.equal(seen[0]?.bodyBytes, 9);
    assert.equal(fake.calls[0]?.init?.method, "POST");
    assert.equal(fake.calls[0]?.init?.body, "payload=1");
  } finally {
    fake.restore();
  }
});

test("request body over the integration bound denies without fetching", async () => {
  clearSessionGrants();
  const normalized = normalizeIntegration({
    origin: "https://api.example.com",
    methods: ["POST"],
    maxBodyBytes: 10,
  });
  assert.ok("integration" in normalized);
  const fake = fakeFetch(() => new Response("{}"));
  try {
    const result = await runTool(
      httpCall({ url: "https://api.example.com/run", method: "POST", body: "x".repeat(500) }),
      ctx({ confirm: () => Promise.resolve(true), integrations: [normalized.integration] }),
    );
    assert.match(result, /exceeds the integration limit/);
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("a live session grant covers reads without asking; expired ones do not", async () => {
  clearSessionGrants();
  grantSessionAccess({
    origin: "https://session.example.com",
    pathPrefix: "/data",
    methods: ["GET"],
  });
  const fake = fakeFetch(() => new Response("session-ok"));
  try {
    const result = await runTool(
      httpCall({ url: "https://session.example.com/data/1" }),
      ctx({ confirm: () => Promise.reject(new Error("must not ask")) }),
    );
    assert.match(JSON.parse(result).data.body, /session-ok/);
    // Different path under the same origin: grant must not cover it.
    const asked: string[] = [];
    await runTool(
      httpCall({ url: "https://session.example.com/other/1" }),
      ctx({ confirm: (req) => (asked.push(req.path), Promise.resolve(false)) }),
    );
    assert.equal(asked.length, 1);
  } finally {
    fake.restore();
    clearSessionGrants();
  }
});

test("credentialed URLs and non-80/443 ports are rejected before fetch", async () => {
  clearSessionGrants();
  const fake = fakeFetch(() => new Response("no"));
  try {
    const credentialed = await runTool(
      httpCall({ url: "https://user:pass@example.com/secret" }),
      ctx({}),
    );
    assert.match(credentialed, /embedded credentials/);
    const badPort = await runTool(httpCall({ url: "http://example.com:8080/" }), ctx({}));
    assert.match(badPort, /ports 80 and 443/);
    const privateIp = await runTool(httpCall({ url: "http://169.254.169.254/latest" }), ctx({}));
    assert.match(privateIp, /blocked/);
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("redirects are refused and the target re-checked", async () => {
  clearSessionGrants();
  const fake = fakeFetch(
    () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }),
  );
  try {
    const result = await runTool(httpCall({ url: "https://api.example.com/a" }), ctx({}));
    assert.match(result, /Tool error: That address is blocked\./);
  } finally {
    fake.restore();
  }
  const fake2 = fakeFetch(() => new Response(null, { status: 302, headers: { location: "/b" } }));
  try {
    const result = await runTool(httpCall({ url: "https://api.example.com/a" }), ctx({}));
    assert.match(result, /HTTP redirect was not followed\./);
  } finally {
    fake2.restore();
  }
});

test("oversized streamed responses abort before buffering; Content-Length rejects early", async () => {
  clearSessionGrants();
  const chunk = new Uint8Array(64 * 1024).fill(66);
  let pulls = 0;
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls > 24) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const fake = fakeFetch(() => new Response(oversized, { status: 200 }));
  try {
    const result = await runTool(httpCall({ url: "https://api.example.com/big" }), ctx({}));
    const parsed = JSON.parse(result) as {
      truncated: boolean;
      data: { bytes: number; truncated: boolean; body: string };
    };
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.data.truncated, true);
    assert.ok(parsed.data.bytes <= RAW_RESPONSE_MAX);
    assert.equal(cancelled, true);
    assert.ok(pulls < 24, "stream aborted before all chunks were pulled");
  } finally {
    fake.restore();
  }

  // Early rejection via Content-Length: the body stream is never read.
  let readAttempts = 0;
  const tracked = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(10));
      controller.close();
    },
    pull() {
      readAttempts += 1;
    },
  });
  const originalGetReader = tracked.getReader.bind(tracked);
  tracked.getReader = (() => {
    readAttempts += 1;
    return originalGetReader();
  }) as typeof tracked.getReader;
  const fake2 = fakeFetch(
    () =>
      new Response(tracked, {
        status: 200,
        headers: { "content-length": String(RAW_RESPONSE_MAX + 1) },
      }),
  );
  try {
    const result = await runTool(httpCall({ url: "https://api.example.com/big2" }), ctx({}));
    assert.match(result, /exceeds the 1 MiB tool limit/);
    assert.equal(readAttempts, 0, "body stream must not be read when Content-Length rejects");
  } finally {
    fake2.restore();
  }
});
