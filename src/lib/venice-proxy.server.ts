/**
 * Same-origin forwarder to Venice. The browser key is passed through and never
 * logged. Creating keys (POST /api_keys) is intentionally not allowed.
 *
 * Upload note (PROXY-002): this Nitro deployment does not give the handler a
 * safely streamable upload path — the incoming body must be materialized
 * before the upstream fetch — so POST bodies are buffered in memory behind a
 * hard byte cap that is enforced during the read and checked up front against
 * Content-Length before any read starts.
 */

const UPSTREAM = "https://api.venice.ai/api/v1";

/**
 * Hard upload cap, enforced during the buffered read. The UI's local file
 * validation allows 10 MB files (LOCAL_MAX_BYTES in voice-changer-core.ts);
 * the extra headroom keeps the proxy limit aligned with that UI maximum plus
 * transfer-encoding margin.
 */
export const MAX_BODY_BYTES = 12_000_000;

const GET_PATH =
  /^\/(?:models(?:\/(?:traits|compatibility_mapping|[^/]+))?|characters(?:\/[^/]+)?)$/;
const POST_PATH =
  /^\/(?:chat\/completions|audio\/(?:speech|transcriptions|voice-changer\/(?:quote|queue|retrieve|complete))|augment\/(?:search|scrape))$/;

export function veniceRouteAllowed(
  method: string,
  path: string,
  search: string,
): { ok: true } | { ok: false; status: number; message: string } {
  if (/api_keys/i.test(path) || path.includes("..")) {
    return { ok: false, status: 404, message: "That Venice route is not available here." };
  }
  const allowed =
    method === "GET" ? GET_PATH.test(path) : method === "POST" ? POST_PATH.test(path) : false;
  if (!allowed) {
    return {
      ok: false,
      status: method === "GET" || method === "POST" ? 404 : 405,
      message:
        method === "GET" || method === "POST"
          ? "That Venice route is not available here."
          : "Method not allowed.",
    };
  }
  if (search) {
    const models = path === "/models" && search.length <= 80;
    const characters = path === "/characters" && search.length <= 500;
    if (!models && !characters) return { ok: false, status: 400, message: "Query not allowed." };
  }
  return { ok: true };
}

/** PROXY-001: per-route time budgets instead of one global timeout. */
export interface RouteBudget {
  /** Overall cap for the upstream exchange, from fetch start to stream end. */
  overallMs: number;
  /**
   * Streaming routes only: abort after this long without a byte from upstream.
   * null disables the watchdog. Non-streaming routes use null.
   */
  inactivityMs: number | null;
}

const CATALOG_BUDGET: RouteBudget = { overallMs: 30_000, inactivityMs: null };
const MEDIA_BUDGET: RouteBudget = { overallMs: 120_000, inactivityMs: null };
const STREAM_BUDGET: RouteBudget = { overallMs: 15 * 60_000, inactivityMs: 60_000 };
const DEFAULT_BUDGET: RouteBudget = { overallMs: 90_000, inactivityMs: null };

const ROUTE_BUDGETS: ReadonlyArray<{ pattern: RegExp; budget: RouteBudget }> = [
  // Streamed chat completions: long generations are legitimate, but a silent
  // upstream is not — bound the whole exchange and watch chunk flow.
  { pattern: /^\/chat\/completions$/, budget: STREAM_BUDGET },
  // Streamed TTS audio.
  { pattern: /^\/audio\/speech$/, budget: STREAM_BUDGET },
  // STT transcriptions handle longer audio inputs.
  { pattern: /^\/audio\/transcriptions$/, budget: MEDIA_BUDGET },
  // Voice Changer quote/queue/retrieve/complete.
  { pattern: /^\/audio\/voice-changer\//, budget: MEDIA_BUDGET },
  // Catalog/model GETs and character search are quick metadata calls.
  { pattern: /^\/(?:models|characters)(?:\/|$)/, budget: CATALOG_BUDGET },
];

export function routeBudget(method: string, path: string): RouteBudget {
  if (method !== "GET" && method !== "POST") return DEFAULT_BUDGET;
  for (const { pattern, budget } of ROUTE_BUDGETS) {
    if (pattern.test(path)) return budget;
  }
  return DEFAULT_BUDGET;
}

/** Thrown by readBodyWithCap once an upload exceeds the byte cap. */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds the proxy upload cap");
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Buffer an upload with the cap enforced DURING the read (PROXY-002): chunks
 * are counted as they arrive and the read stops as soon as the running total
 * exceeds the cap, instead of buffering the whole body before checking. Full
 * streaming upload is not safely available on this Nitro deployment, so
 * bounded buffering is the only option here.
 */
export async function readBodyWithCap(
  request: Request,
  capBytes: number = MAX_BODY_BYTES,
): Promise<ArrayBuffer> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > capBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function allowProcessExit(timer: unknown): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => unknown }).unref();
  }
}

/**
 * Inactivity watchdog for streamed upstream responses (PROXY-001): a timer is
 * reset on every chunk and fires after `timeoutMs` without a byte, aborting
 * `controller`, which is wired into the fetch's combined AbortSignal so the
 * upstream read is cancelled. The wrapped stream mirrors the upstream — chunks
 * pass through unchanged, and an aborted upstream ends the client response
 * cleanly instead of surfacing an abort error. Genuine network errors
 * propagate.
 */
export function trackUpstreamActivity(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number,
  controller: AbortController,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const clearWatchdog = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const bump = () => {
    if (settled) return;
    clearWatchdog();
    timer = setTimeout(() => {
      settled = true;
      controller.abort();
    }, timeoutMs);
    allowProcessExit(timer);
  };

  bump();
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          settled = true;
          clearWatchdog();
          streamController.close();
          return;
        }
        bump();
        streamController.enqueue(value);
      } catch (error) {
        settled = true;
        clearWatchdog();
        if (signal.aborted) streamController.close();
        else streamController.error(error);
      }
    },
    cancel(reason) {
      settled = true;
      clearWatchdog();
      return reader.cancel(reason);
    },
  });
}

/**
 * PROXY-003: upstream response headers worth exposing to the app — retry and
 * backoff hints, rate-limit metadata (any `x-ratelimit-*` / `x-rate-limit-*`
 * variant), request IDs for debugging, payload metadata, and the Venice
 * balance headers the UI surfaces. Everything else — including any
 * authorization or cookie headers — is dropped.
 */
const FORWARD_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "content-disposition",
  "content-length",
  "content-type",
  "request-id",
  "retry-after",
  "x-request-id",
  "x-venice-balance-diem",
  "x-venice-balance-usd",
  "x-venice-request-id",
]);

function isForwardableResponseHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    FORWARD_RESPONSE_HEADERS.has(lower) ||
    lower.startsWith("x-ratelimit-") ||
    lower.startsWith("x-rate-limit-")
  );
}

/** Build the client response header set from the upstream response. */
export function forwardHeaders(upstreamHeaders: Headers): Headers {
  const out = new Headers();
  out.set("cache-control", "no-store");
  upstreamHeaders.forEach((value, name) => {
    if (isForwardableResponseHeader(name)) out.set(name, value);
  });
  return out;
}

function json(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function scrub(text: string, key: string): string {
  const cleaned = key ? text.split(key).join("…") : text;
  return cleaned.slice(0, 2000);
}

export async function proxyVenice(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;
  const marker = "/api/venice";
  const at = path.indexOf(marker);
  path = at >= 0 ? path.slice(at + marker.length) || "/" : path;
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/";

  if (path.includes("..")) return json(404, "That Venice route is not available here.");
  const gate = veniceRouteAllowed(request.method, path, url.search);
  if (!gate.ok) return json(gate.status, gate.message);

  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S{8,400})$/.exec(auth);
  if (!match) return json(401, "Add a Venice API key first.");
  const key = match[1];

  // Reject oversize uploads from the declared length before reading anything.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return json(413, "That upload is too large.");

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    try {
      body = await readBodyWithCap(request);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return json(413, "That upload is too large.");
      throw error;
    }
  }

  // PROXY-001: overall route budget + client disconnect + inactivity watchdog.
  const budget = routeBudget(request.method, path);
  const signals: AbortSignal[] = [AbortSignal.timeout(budget.overallMs), request.signal];
  let inactivityController: AbortController | null = null;
  if (budget.inactivityMs != null) {
    inactivityController = new AbortController();
    signals.push(inactivityController.signal);
  }
  const signal = AbortSignal.any(signals);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${key}`);
  const contentType = request.headers.get("content-type");
  if (contentType && request.method === "POST") headers.set("Content-Type", contentType);

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}${path}${url.search}`, {
      method: request.method,
      headers,
      body: body && body.byteLength ? body : undefined,
      signal,
    });
  } catch {
    return json(502, "Could not reach Venice.");
  }

  const out = forwardHeaders(upstream.headers);
  const ct = upstream.headers.get("content-type");

  // Readable error payloads are buffered and scrubbed; this must happen before
  // the watchdog locks the upstream reader below.
  if (!upstream.ok && ct && (ct.includes("json") || ct.includes("text"))) {
    const text = scrub(await upstream.text(), key);
    // The scrubbed payload length differs from the upstream declaration.
    out.delete("content-length");
    return new Response(text, { status: upstream.status, headers: out });
  }

  let responseBody: ReadableStream<Uint8Array> | null = upstream.body;
  if (inactivityController && budget.inactivityMs != null && responseBody) {
    // The watchdog may truncate the payload, so a fixed byte count cannot be
    // promised to the client on streaming routes.
    out.delete("content-length");
    responseBody = trackUpstreamActivity(
      responseBody,
      budget.inactivityMs,
      inactivityController,
      signal,
    );
  }

  return new Response(responseBody, { status: upstream.status, headers: out });
}
