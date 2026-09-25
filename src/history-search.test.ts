import assert from "node:assert/strict";
import test from "node:test";
import type { ChatRecord } from "./chats.ts";
import {
  estimateStorageBytes,
  firstUserPreview,
  formatBytes,
  formatStamp,
  groupChats,
  searchHistory,
} from "./history-search.ts";
import type { Turn } from "./state.ts";

const DAY_MS = 86400000;

function makeChat(id: string, overrides: Partial<ChatRecord> = {}): ChatRecord {
  return { id, title: "Chat", updatedAt: 0, pinned: false, turns: [], ...overrides };
}

test("search finds content in user and assistant turns, not just titles (CHAT-007)", () => {
  const now = Date.now();
  const chats: ChatRecord[] = [
    makeChat("chat-title0001", { title: "Phoenix trip", updatedAt: now - 1000 }),
    makeChat("chat-body00002", {
      title: "Random notes",
      updatedAt: now - 2000,
      turns: [{ role: "user", content: "I keep thinking about PHOENIX weather" }],
    }),
    makeChat("chat-assist003", {
      title: "Other",
      updatedAt: now - 3000,
      turns: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "phoenix is warm this week" },
      ],
    }),
    makeChat("chat-none00004", { title: "Nothing here", updatedAt: now - 4000 }),
  ];
  const matches = searchHistory(chats, "phoenix");
  assert.deepEqual(
    matches.map((match) => match.chatId).sort(),
    ["chat-title0001", "chat-body00002", "chat-assist003"].sort(),
  );
  const byId = new Map(matches.map((match) => [match.chatId, match]));
  assert.equal(byId.get("chat-title0001")?.field, "title");
  assert.equal(byId.get("chat-body00002")?.field, "user");
  assert.equal(byId.get("chat-assist003")?.field, "assistant");
});

test("search is case-insensitive and returns capped snippets", () => {
  const longBody = `Intro words. ${"filler ".repeat(200)}NEEDLE${" more text".repeat(120)}`;
  const chats: ChatRecord[] = [
    makeChat("chat-long000001", { turns: [{ role: "assistant", content: longBody }] }),
  ];
  const matches = searchHistory(chats, "needle");
  assert.equal(matches.length, 1);
  const snippet = matches[0]?.snippet ?? "";
  assert.ok(snippet.length <= 122);
  assert.match(snippet.toLowerCase(), /needle/);
  assert.equal(searchHistory(chats, "needle")[0]?.snippet.includes("…"), true);
});

test("empty queries return nothing and matches respect the limit", () => {
  assert.deepEqual(searchHistory([], "x"), []);
  const chats = Array.from({ length: 30 }, (_, index) =>
    makeChat(`chat-limit-${index}`, {
      updatedAt: index,
      turns: [{ role: "user", content: "match me" }],
    }),
  );
  assert.equal(searchHistory(chats, "match").length, 20);
  assert.equal(searchHistory(chats, "   ").length, 0);
});

test("firstUserPreview flattens and caps the first user message", () => {
  const turns: Turn[] = [
    { role: "assistant", content: "earlier" },
    { role: "user", content: "  line one\nline two   " },
  ];
  assert.equal(firstUserPreview(turns), "line one line two");
  assert.equal(firstUserPreview([{ role: "user", content: "a".repeat(200) }]).length, 72);
  assert.equal(firstUserPreview([]), "");
});

test("groupChats buckets Today, Yesterday, Previous 7 days, Older", () => {
  const now = new Date(2026, 8, 24, 15, 30).getTime();
  const today = makeChat("chat-today0001", { updatedAt: now - 3600000 });
  const yesterday = makeChat("chat-yester002", { updatedAt: now - DAY_MS - 3600000 });
  const lastWeek = makeChat("chat-week00003", { updatedAt: now - 3 * DAY_MS });
  const older = makeChat("chat-old000004", { updatedAt: now - 30 * DAY_MS });
  const groups = groupChats([older, today, lastWeek, yesterday], now);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["today", "yesterday", "week", "older"],
  );
  assert.deepEqual(
    groups[0]?.chats.map((chat) => chat.id),
    [today.id],
  );
  assert.deepEqual(
    groups[1]?.chats.map((chat) => chat.id),
    [yesterday.id],
  );
  assert.deepEqual(
    groups[2]?.chats.map((chat) => chat.id),
    [lastWeek.id],
  );
  assert.deepEqual(
    groups[3]?.chats.map((chat) => chat.id),
    [older.id],
  );
});

test("formatStamp shows clock time today and relative labels recently", () => {
  const now = new Date(2026, 8, 24, 15, 30).getTime();
  assert.equal(formatStamp(now - 3600000, now), "14:30");
  assert.equal(formatStamp(now - DAY_MS - 60_000, now), "Yesterday");
  const threeDaysBack = now - 3 * DAY_MS;
  assert.equal(
    formatStamp(threeDaysBack, now),
    new Date(threeDaysBack).toLocaleDateString(undefined, { weekday: "short" }),
  );
  const monthBack = now - 30 * DAY_MS;
  assert.equal(
    formatStamp(monthBack, now),
    new Date(monthBack).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  );
});

test("storage estimate and formatting", () => {
  const chats = [makeChat("chat-size00001", { turns: [{ role: "user", content: "hello" }] })];
  assert.ok(estimateStorageBytes(chats) > 0);
  assert.equal(estimateStorageBytes([]), 0);
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});
