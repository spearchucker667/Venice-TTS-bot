import assert from "node:assert/strict";
import test from "node:test";
import { trimUrlPunctuation } from "./rich-text-utils.ts";

test("UI-007: trimUrlPunctuation removes trailing punctuation from prose URLs", () => {
  // Trailing period at end of sentence
  assert.deepEqual(trimUrlPunctuation("https://example.com/page."), {
    url: "https://example.com/page",
    trailing: ".",
  });

  // Trailing comma
  assert.deepEqual(trimUrlPunctuation("https://example.com/api,"), {
    url: "https://example.com/api",
    trailing: ",",
  });

  // Trailing parenthesis (e.g. inside a parenthetical clause)
  assert.deepEqual(trimUrlPunctuation("https://example.com/docs)"), {
    url: "https://example.com/docs",
    trailing: ")",
  });

  // Multiple trailing punctuation characters (e.g. "?!")
  assert.deepEqual(trimUrlPunctuation("https://example.com/what?!"), {
    url: "https://example.com/what",
    trailing: "?!",
  });

  // URL without trailing punctuation is untouched
  assert.deepEqual(trimUrlPunctuation("https://example.com/path?query=1"), {
    url: "https://example.com/path?query=1",
    trailing: "",
  });

  // URL with slashes and query parameters but trailing dot
  assert.deepEqual(trimUrlPunctuation("https://venice.ai/models/v1."), {
    url: "https://venice.ai/models/v1",
    trailing: ".",
  });
});
