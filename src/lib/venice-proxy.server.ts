/**
 * Same-origin forwarder to Venice. The browser key is passed through and never
 * logged. Creating keys (POST /api_keys) is intentionally not allowed.
 */

const UPSTREAM = "https://api.venice.ai/api/v1";
const MAX_BODY = 12_000_000;

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

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return json(413, "That upload is too large.");

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return json(413, "That upload is too large.");
  }

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
      signal: AbortSignal.any([AbortSignal.timeout(90_000), request.signal]),
    });
  } catch {
    return json(502, "Could not reach Venice.");
  }

  const out = new Headers();
  out.set("cache-control", "no-store");
  const ct = upstream.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  for (const name of ["x-venice-balance-usd", "x-venice-balance-diem"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }

  if (!upstream.ok && ct && (ct.includes("json") || ct.includes("text"))) {
    const text = scrub(await upstream.text(), key);
    return new Response(text, { status: upstream.status, headers: out });
  }

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
