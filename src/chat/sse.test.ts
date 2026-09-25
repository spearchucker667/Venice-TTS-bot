import assert from "node:assert/strict";
import test from "node:test";
import { createSseParser, type SseFrame } from "./sse.ts";

function collect(chunks: string[]): SseFrame[] {
  const frames: SseFrame[] = [];
  const parser = createSseParser((frame) => frames.push(frame));
  for (const chunk of chunks) parser.push(chunk);
  parser.finish();
  return frames;
}

test("joins multi-line data and ignores comments", () => {
  const frames = collect([": ping\ndata: hello\ndata: world\n\n"]);
  assert.deepEqual(frames, [{ event: "message", data: "hello\nworld" }]);
});

test("accepts CRLF and a final event without a trailing blank line", () => {
  const frames = collect(["data: one\r\n\r\n", "data: two"]);
  assert.deepEqual(frames, [
    { event: "message", data: "one" },
    { event: "message", data: "two" },
  ]);
});

test("does not emit a partial frame until the boundary or finish", () => {
  const frames: SseFrame[] = [];
  const parser = createSseParser((frame) => frames.push(frame));
  parser.push('data: {"a":');
  assert.equal(frames.length, 0);
  parser.push("1}\n\n");
  assert.deepEqual(frames, [{ event: "message", data: '{"a":1}' }]);
});

test("keeps a named event", () => {
  const frames = collect(["event: done\ndata: [DONE]\n\n"]);
  assert.deepEqual(frames, [{ event: "done", data: "[DONE]" }]);
});
