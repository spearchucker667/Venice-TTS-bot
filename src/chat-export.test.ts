import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatExport,
  CHAT_EXPORT_VERSION,
  ChatExportVersionError,
  IMPORT_LIMITS,
  migrateV1ToCurrent,
  parseChatExport,
  parseChatImport,
  parseExportVersion,
} from "./chat-export.ts";
import type { ChatRecord } from "./chats.ts";
import type { Turn } from "./state.ts";

const EXPORTED_AT = "2026-09-24T12:00:00.000Z";

function chat(id: string, turns: Turn[], extra: Partial<ChatRecord> = {}): ChatRecord {
  return { id, title: "Chat", updatedAt: 1000, pinned: false, turns, ...extra };
}

function roundTrip(turns: Turn[], extra: Partial<ChatRecord> = {}): ChatRecord[] {
  const original = [chat("chat-export1", turns, extra)];
  const exported = buildChatExport(original, EXPORTED_AT);
  assert.equal(exported.version, 1);
  assert.equal(exported.exportedAt, EXPORTED_AT);
  const result = parseChatImport(exported);
  assert.equal(result.summary.idConflicts, 0);
  assert.equal(result.summary.archivedTransactions, 0);
  assert.equal(result.summary.droppedOrphanTools, 0);
  return result.chats;
}

test("export → parse → export round trip: plain conversation", () => {
  const turns: Turn[] = [
    { role: "user", content: "Hello there" },
    { role: "assistant", content: "Hi! How can I help?" },
  ];
  const rows = roundTrip(turns);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.turns, turns);
});

test("round trip preserves citations and thinking", () => {
  const turns: Turn[] = [
    { role: "user", content: "search for ember" },
    {
      role: "assistant",
      content: "Here is what I found.",
      thinking: "The user wants a summary.",
      citations: [{ title: "Ember docs", url: "https://example.com/ember" }],
    },
  ];
  const rows = roundTrip(turns);
  assert.deepEqual(rows[0]?.turns, turns);
});

test("round trip preserves one tool call with its result", () => {
  const turns: Turn[] = [
    { role: "user", content: "check the weather" },
    {
      role: "assistant",
      content: "Checking now.",
      tool_calls: [{ id: "call_1", name: "venice_web_search", arguments: '{"q":"weather"}' }],
    },
    { role: "tool", content: "Sunny, 21C", tool_call_id: "call_1", name: "venice_web_search" },
    { role: "assistant", content: "It is sunny and 21 degrees." },
  ];
  const rows = roundTrip(turns);
  assert.deepEqual(rows[0]?.turns, turns);
});

test("round trip preserves multiple tool calls in order", () => {
  const turns: Turn[] = [
    { role: "user", content: "compare two things" },
    {
      role: "assistant",
      content: "Looking both up.",
      tool_calls: [
        { id: "call_a", name: "venice_web_search", arguments: '{"q":"a"}' },
        { id: "call_b", name: "venice_scrape", arguments: '{"q":"b"}' },
      ],
    },
    { role: "tool", content: "result a", tool_call_id: "call_a", name: "venice_web_search" },
    { role: "tool", content: "result b", tool_call_id: "call_b", name: "venice_scrape" },
  ];
  const rows = roundTrip(turns);
  assert.deepEqual(rows[0]?.turns, turns);
});

test("malformed tool transaction is archived, never kept as orphan protocol", () => {
  const turns: Turn[] = [
    { role: "user", content: "check the weather" },
    {
      role: "assistant",
      content: "Checking now.",
      tool_calls: [{ id: "call_1", name: "venice_web_search", arguments: "{}" }],
    },
    // Result carries the wrong id → the whole transaction is malformed.
    { role: "tool", content: "Sunny", tool_call_id: "call_OTHER", name: "venice_web_search" },
    { role: "assistant", content: "Done." },
  ];
  const exported = buildChatExport([chat("chat-malformed01", turns)], EXPORTED_AT);
  const result = parseChatImport(exported);
  assert.equal(result.summary.archivedTransactions, 1);
  const rows = result.chats;
  const repaired = rows[0]?.turns ?? [];
  assert.equal(
    repaired.some((turn) => turn.role === "tool"),
    false,
  );
  assert.equal(
    repaired.some((turn) => turn.role === "assistant" && turn.tool_calls),
    false,
  );
  const archived = repaired[1];
  assert.equal(archived?.role, "assistant");
  assert.match(archived?.content ?? "", /archived incomplete tool call/);
  assert.equal(archived?.content.includes("Checking now."), true);
});

test("missing tool result archives the transaction instead of leaving a dangling call", () => {
  const turns: Turn[] = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "On it.",
      tool_calls: [{ id: "call_1", name: "venice_web_search", arguments: "{}" }],
    },
  ];
  const exported = buildChatExport([chat("chat-missingres01", turns)], EXPORTED_AT);
  const result = parseChatImport(exported);
  assert.equal(result.summary.archivedTransactions, 1);
  const rows = result.chats;
  const repaired = rows[0]?.turns ?? [];
  assert.equal(repaired.length, 2);
  assert.equal(
    repaired.some((turn) => turn.role === "tool"),
    false,
  );
});

test("orphan tool turn with no assistant call is dropped and counted", () => {
  const turns: Turn[] = [
    { role: "user", content: "hi" },
    { role: "tool", content: "stray result", tool_call_id: "call_x", name: "some_tool" },
  ];
  const exported = buildChatExport([chat("chat-orphan01", turns)], EXPORTED_AT);
  const result = parseChatImport(exported);
  assert.equal(result.summary.droppedOrphanTools, 1);
  const repaired = result.chats[0]?.turns ?? [];
  assert.equal(
    repaired.some((turn) => turn.role === "tool"),
    false,
  );
});

test("duplicate imported id gets a fresh id and is reported (CHAT-003)", () => {
  const existing = chat("chat-existing1", [{ role: "user", content: "original" }]);
  const incoming = buildChatExport([existing], EXPORTED_AT);
  const result = parseChatImport(incoming, new Set([existing.id]));
  assert.equal(result.chats.length, 1);
  assert.notEqual(result.chats[0]?.id, existing.id);
  assert.equal(result.summary.idConflicts, 1);
  // Without a collision the original id is preserved.
  const kept = parseChatImport(incoming);
  assert.equal(kept.chats[0]?.id, existing.id);
});

test("future export versions are rejected with a clear message (CHAT-004)", () => {
  const future = { version: CHAT_EXPORT_VERSION + 1, exportedAt: EXPORTED_AT, chats: [] };
  assert.throws(
    () => parseChatImport(future),
    (err: unknown) => {
      assert.ok(err instanceof ChatExportVersionError);
      assert.match(err.message, /version 2/);
      assert.match(err.message, /version 1 exports/);
      return true;
    },
  );
  assert.throws(() => parseChatExport(future), ChatExportVersionError);
  assert.equal(parseExportVersion(future), CHAT_EXPORT_VERSION + 1);
});

test("legacy unversioned exports parse as version 1", () => {
  assert.equal(parseExportVersion([{ id: "chat-legacy01", turns: [] }]), 1);
  assert.equal(parseExportVersion({ chats: [] }), 1);
  assert.equal(parseExportVersion({ not: "an export" }), null);
  assert.equal(parseExportVersion("nope"), null);
  const legacy = {
    chats: [
      { title: "Kept", turns: [{ role: "user", content: "Hi" }], id: "chat-12345678" },
      { nope: true },
    ],
  };
  const rows = migrateV1ToCurrent(legacy);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "Kept");
  const viaWrapper = parseChatExport(legacy);
  assert.deepEqual(viaWrapper, rows);
});

test("oversized imports are capped (CHAT-006)", () => {
  assert.equal(IMPORT_LIMITS.maxFileBytes, 8 * 1024 * 1024);
  const manyChats = Array.from({ length: IMPORT_LIMITS.maxChats + 50 }, (_, index) =>
    chat(`chat-many-${index}`, [{ role: "user", content: `chat ${index}` }]),
  );
  const tooMany = parseChatImport(buildChatExport(manyChats, EXPORTED_AT));
  assert.equal(tooMany.chats.length, IMPORT_LIMITS.maxChats);
  assert.equal(tooMany.summary.truncated, true);

  const manyTurns: Turn[] = Array.from(
    { length: IMPORT_LIMITS.maxTurnsPerChat + 100 },
    (_, index) => ({
      role: "user" as const,
      content: `turn ${index}`,
    }),
  );
  const tooLong = parseChatImport(buildChatExport([chat("chat-long0001", manyTurns)], EXPORTED_AT));
  const turns = tooLong.chats[0]?.turns ?? [];
  assert.equal(turns.length, IMPORT_LIMITS.maxTurnsPerChat);
  assert.equal(turns.at(-1)?.content, `turn ${IMPORT_LIMITS.maxTurnsPerChat + 99}`);
  assert.equal(tooLong.summary.truncated, true);

  const oversizedTurn: Turn = { role: "user", content: "x".repeat(30000) };
  const capped = parseChatImport(
    buildChatExport([chat("chat-big00001", [oversizedTurn])], EXPORTED_AT),
  );
  assert.equal(capped.chats[0]?.turns[0]?.content.length, 20000);
});

test("import summary reports invalid rows and dropped turns", () => {
  const payload: unknown = {
    version: 1,
    exportedAt: EXPORTED_AT,
    chats: [
      chat("chat-good0001", [{ role: "user", content: "hi" }]),
      { title: "no turns array" },
      // Adversarial: turn with invalid role — cast through unknown so tsc accepts this test fixture
      {
        ...chat("chat-badturn2", [{ role: "user", content: "ok" }]),
        turns: [
          { role: "user", content: "ok" },
          { role: "mystery", content: "drop me" },
        ],
      },
    ],
  };
  const result = parseChatImport(payload);
  assert.equal(result.summary.imported, 2);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.droppedTurns, 1);
});
