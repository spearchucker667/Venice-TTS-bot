import assert from "node:assert/strict";
import test from "node:test";
import { contentLengthOverLimit, readBoundedBody, RAW_RESPONSE_MAX } from "./response-budget.ts";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("contentLengthOverLimit treats Content-Length as a hint only", () => {
  assert.equal(
    contentLengthOverLimit(new Headers({ "content-length": String(RAW_RESPONSE_MAX + 1) })),
    true,
  );
  assert.equal(
    contentLengthOverLimit(new Headers({ "content-length": String(RAW_RESPONSE_MAX) })),
    false,
  );
  assert.equal(contentLengthOverLimit(new Headers({ "content-length": "10" })), false);
  assert.equal(contentLengthOverLimit(new Headers({ "content-length": "garbage" })), false);
  assert.equal(contentLengthOverLimit(new Headers()), false);
});

test("readBoundedBody passes through bodies under the limit", async () => {
  const data = new TextEncoder().encode('{"hello":"world"}');
  const result = await readBoundedBody(streamOf([data]), 1024);
  assert.deepEqual(result, { ok: true, text: '{"hello":"world"}', bytes: 17, truncated: false });
  const empty = await readBoundedBody(null, 1024);
  assert.deepEqual(empty, { ok: true, text: "", bytes: 0, truncated: false });
});

test("readBoundedBody aborts before buffering an oversized streamed response", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(65); // 64 KiB
  const totalChunks = 24; // 1.5 MiB total, well over the default 1 MiB cap
  let pulls = 0;
  let cancelled = false;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (produced >= totalChunks) {
        controller.close();
        return;
      }
      produced += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await readBoundedBody(stream);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.truncated, true);
  assert.ok(result.bytes <= RAW_RESPONSE_MAX);
  assert.equal(result.bytes, 16 * 64 * 1024); // 16 chunks exactly fill 1 MiB; the 17th is rejected
  assert.equal(cancelled, true, "stream must be cancelled after the abort");
  assert.ok(
    pulls < totalChunks,
    `abort must stop pulling (pulled ${pulls} of ${totalChunks} chunks)`,
  );
  assert.equal(result.text.length, 16 * 64 * 1024);
});

test("readBoundedBody honours an exact limit and decodes split multi-byte characters", async () => {
  const encoder = new TextEncoder();
  const euro = encoder.encode("€"); // 3 bytes
  const chunks = [encoder.encode("a"), euro.slice(0, 1), euro.slice(1), encoder.encode("z")];
  const exact = await readBoundedBody(streamOf(chunks), 5);
  assert.deepEqual(exact, { ok: true, text: "a€z", bytes: 5, truncated: false });
  const cut = await readBoundedBody(streamOf(chunks), 2);
  assert.ok(cut.ok);
  if (!cut.ok) return;
  assert.equal(cut.truncated, true);
  assert.equal(
    cut.bytes,
    2,
    "the partial multi-byte chunk that fits is buffered; the next one is refused",
  );
  assert.equal(cut.text, "a");
});

test("readBoundedBody reports stream errors", async () => {
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.error(new Error("boom"));
    },
  });
  const result = await readBoundedBody(broken, 1024);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /boom/);
});
