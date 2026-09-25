/**
 * Response-size budget for the model-driven HTTP tool (HTTP-003).
 *
 * Tool responses are read as a stream and aborted at a hard raw-byte maximum
 * BEFORE buffering completes, so a huge response cannot exhaust browser
 * memory. Content-Length is used as an early rejection hint only — the stream
 * bound is enforced regardless, since a server may omit or lie about it.
 */

export const RAW_RESPONSE_MAX = 1024 * 1024; // 1 MiB raw response cap

/** True when an explicit Content-Length exceeds the raw limit (a hint, not the bound). */
export function contentLengthOverLimit(headers: Headers, limit = RAW_RESPONSE_MAX): boolean {
  const raw = headers.get("content-length");
  if (!raw) return false;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > limit;
}

export type BoundedBody =
  { ok: true; text: string; bytes: number; truncated: boolean } | { ok: false; error: string };

/**
 * Read at most `limit` raw bytes from a response stream.
 *
 * The chunk that crosses the limit is never buffered and the stream is
 * cancelled, so the caller keeps at most ~limit bytes in memory. Decoding uses
 * a streaming TextDecoder, so multi-byte characters split across chunks are
 * handled and a body truncated mid-character does not throw.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit = RAW_RESPONSE_MAX,
): Promise<BoundedBody> {
  if (!body) return { ok: true, text: "", bytes: 0, truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (bytes + value.byteLength > limit) {
        truncated = true;
        break;
      }
      bytes += value.byteLength;
      parts.push(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    return { ok: false, error: err instanceof Error ? err.message : "stream read failed" };
  }
  if (truncated) {
    await reader.cancel().catch(() => undefined);
  } else {
    parts.push(decoder.decode());
  }
  return { ok: true, text: parts.join(""), bytes, truncated };
}
