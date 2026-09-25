import assert from "node:assert/strict";
import test from "node:test";
import { parseChatExport, titleFromTurns } from "./chats.ts";
import { readySentences, spokenText } from "./speech.ts";
import {
  PRESETS,
  contextWindow,
  resolveTextModel,
  systemContent,
  type Persona,
  DEFAULT_PERSONA,
} from "./state.ts";

test("titles come from the first user line", () => {
  assert.equal(
    titleFromTurns([{ role: "user", content: "  Hello   there friend  " }]),
    "Hello there friend",
  );
  assert.equal(titleFromTurns([]), "New chat");
});

test("readySentences keeps an unfinished clause", () => {
  const split = readySentences("Hello there. How are");
  assert.deepEqual(split.ready, ["Hello there."]);
  assert.equal(split.rest, "How are");
});

test("presets are explicit generation settings", () => {
  assert.equal(PRESETS.precise.temperature, 0.2);
  assert.ok(PRESETS.creative.temperature > PRESETS.balanced.temperature);
});

test("trait resolution does not invent a hardcoded model id", () => {
  assert.equal(resolveTextModel("trait:default", {}), "");
  assert.equal(resolveTextModel("trait:default", { default: "live-model" }), "live-model");
  assert.equal(resolveTextModel("specific-id", {}), "specific-id");
});

test("context window keeps the newest turns inside a budget", () => {
  const turns = Array.from({ length: 10 }, (_, index) => ({
    role: "user" as const,
    content: "word ".repeat(400) + index,
  }));
  const kept = contextWindow(turns, 500);
  assert.ok(kept.length < turns.length);
  assert.equal(kept[0]?.role, "user");
  assert.equal(kept.at(-1)?.content, turns.at(-1)?.content);
});

test("character mode does not paste the full persona prompt", () => {
  const persona: Persona = { ...DEFAULT_PERSONA, promptMode: "character", characterSlug: "guide" };
  const text = systemContent(persona);
  assert.match(text, /guide/);
  assert.equal(text.includes(DEFAULT_PERSONA.systemPrompt), false);
});

test("speech keeps the tail instead of dropping it", () => {
  const clean = spokenText(`Hello. ${"A".repeat(20)}`);
  assert.ok(clean.startsWith("Hello."));
  const split = readySentences("Mr. Smith arrived. Next.");
  assert.equal(split.ready.length, 0);
});

test("chat export ignores junk and keeps titles", () => {
  const rows = parseChatExport({
    chats: [
      { title: "Kept", turns: [{ role: "user", content: "Hi" }], id: "chat-12345678" },
      { nope: true },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "Kept");
  assert.equal(rows[0]?.turns[0]?.content, "Hi");
});
