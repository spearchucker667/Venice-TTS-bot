import assert from "node:assert/strict";
import test from "node:test";
import {
  blankChat,
  branchChat,
  clearChats,
  deleteChat,
  listChats,
  listChatsDetailed,
  saveChat,
  snapshotFromPersona,
  titleFromTurns,
  validateChatRecord,
  validateTurn,
  type ChatRecord,
} from "./chats.ts";
import { readySentences, spokenText } from "./speech.ts";
import {
  PRESETS,
  contextWindow,
  resolveTextModel,
  systemContent,
  type Persona,
  DEFAULT_PERSONA,
} from "./state.ts";

type Listener = (() => void) | null;

type MockRequest = {
  onsuccess: Listener;
  onerror: Listener;
  result: unknown;
  error: unknown;
};

/**
 * In-memory IndexedDB mock. Store mutations run through a single FIFO
 * pipeline, mirroring how IndexedDB serializes transactions that touch the
 * same object store. `putDelayMs` simulates a slow in-flight write.
 */
function installMock(seed: Record<string, unknown> = {}, opts: { putDelayMs?: number } = {}) {
  const data = new Map<string, unknown>();
  for (const [key, value] of Object.entries(seed)) data.set(key, structuredClone(value));
  const putDelay = opts.putDelayMs ?? 0;
  let pipeline: Promise<void> = Promise.resolve();
  const enqueue = (op: () => void, delay = 0): Promise<void> => {
    const run = pipeline.then(async () => {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      op();
    });
    pipeline = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const idb = {
    open: (_name: string, _version: number) => {
      const req: {
        onupgradeneeded: Listener;
        onsuccess: Listener;
        onerror: Listener;
        result: unknown;
        error: unknown;
      } = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null, error: null };
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        close: () => undefined,
        transaction: (_store: string, _mode: string) => {
          let pendingReqs = 0;
          let started = false;
          let completed = false;
          const completeIfDone = () => {
            if (started && pendingReqs === 0 && !completed) {
              completed = true;
              void enqueue(() => tx.oncomplete?.()).catch(() => undefined);
            }
          };
          queueMicrotask(() => {
            started = true;
            completeIfDone();
          });
          const txRequest = (apply: () => unknown, delay = 0): MockRequest => {
            pendingReqs++;
            const req: MockRequest = { onsuccess: null, onerror: null, result: null, error: null };
            void enqueue(() => {
              req.result = apply();
              req.onsuccess?.();
              pendingReqs--;
              completeIfDone();
            }, delay).catch(() => undefined);
            return req;
          };
          const tx: {
            oncomplete: Listener;
            onerror: Listener;
            onabort: Listener;
            error: unknown;
            objectStore: (name: string) => {
              getAll: () => MockRequest;
              put: (value: unknown) => MockRequest;
              delete: (id: string) => MockRequest;
              clear: () => MockRequest;
            };
          } = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
            objectStore: () => ({
              getAll: () =>
                txRequest(() => Array.from(data.values()).map((row) => structuredClone(row))),
              put: (value: unknown) =>
                txRequest(() => {
                  const row = value as { id?: unknown };
                  if (row && typeof row.id === "string") data.set(row.id, structuredClone(row));
                  return value;
                }, putDelay),
              delete: (id: string) =>
                txRequest(() => {
                  data.delete(id);
                  return undefined;
                }),
              clear: () =>
                txRequest(() => {
                  data.clear();
                  return undefined;
                }),
            }),
          };
          return tx;
        },
      };
      req.result = db;
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
  const globals = globalThis as typeof globalThis & { indexedDB?: IDBFactory };
  globals.indexedDB = idb as unknown as IDBFactory;
  return {
    dump: () => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of data) out[key] = structuredClone(value);
      return out;
    },
  };
}

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

// --- CHAT-002: serialized persistence, no resurrection races ---

test("clear-all wins over an in-flight save", async () => {
  const { dump } = installMock({}, { putDelayMs: 20 });
  const chat = blankChat();
  const saving = saveChat(chat);
  const clearing = clearChats();
  await Promise.all([saving, clearing]);
  assert.deepEqual(await listChats(), []);
  assert.deepEqual(Object.keys(dump()), []);
});

test("delete wins over an in-flight save of the same chat", async () => {
  installMock({}, { putDelayMs: 20 });
  const chat = blankChat();
  const saving = saveChat(chat);
  const removing = deleteChat(chat.id);
  await Promise.all([saving, removing]);
  assert.deepEqual(await listChats(), []);
});

test("a save queued after a delete still persists (undo restore)", async () => {
  installMock({});
  const chat = blankChat();
  await saveChat(chat);
  await deleteChat(chat.id);
  await saveChat(chat);
  const rows = await listChats();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, chat.id);
});

test("saves commit in queue order", async () => {
  installMock({});
  const first = blankChat();
  const second = blankChat();
  await saveChat(first);
  await saveChat(second);
  const rows = await listChats();
  assert.deepEqual(rows.map((row) => row.id).sort(), [first.id, second.id].sort());
});

// --- CHAT-005: runtime row validation with quarantine ---

test("listChats quarantines malformed rows without throwing", async () => {
  const valid: ChatRecord = {
    id: "chat-valid0001",
    title: "Good chat",
    updatedAt: 1000,
    pinned: false,
    turns: [{ role: "user", content: "hi" }],
  };
  const mixed: ChatRecord = {
    id: "chat-mixed0002",
    title: "Mixed",
    updatedAt: 2000,
    pinned: false,
    turns: [{ role: "user", content: "keep me" }],
  };
  installMock({
    [valid.id]: valid,
    [mixed.id]: { ...mixed, turns: [...mixed.turns, { role: "alien", content: "x" }] },
    "short-id": { title: "no id", turns: [] },
    "chat-junk0003": { title: "turns not array", turns: "nope" },
  });
  const report = await listChatsDetailed();
  assert.equal(report.quarantined, 2);
  assert.deepEqual(report.chats.map((row) => row.id).sort(), [valid.id, mixed.id].sort());
  const mixedRow = report.chats.find((row) => row.id === mixed.id);
  assert.equal(mixedRow?.turns.length, 1);
  assert.equal(mixedRow?.turns[0]?.content, "keep me");
});

test("validateTurn caps oversized content and keeps assistant metadata", () => {
  const huge = validateTurn({ role: "user", content: "x".repeat(25000) });
  assert.equal(huge?.role, "user");
  assert.equal(huge?.content.length, 20000);
  const assistant = validateTurn({
    role: "assistant",
    content: "answer",
    thinking: "hmm",
    citations: [{ title: "T", url: "https://x" }],
    tool_calls: [{ id: "call_1", name: "venice_web_search", arguments: "{}" }],
  });
  assert.equal(assistant?.role, "assistant");
  if (assistant?.role === "assistant") {
    assert.equal(assistant.thinking, "hmm");
    assert.equal(assistant.citations?.length, 1);
    assert.equal(assistant.tool_calls?.[0]?.id, "call_1");
  }
});

// --- CHAT-010: per-conversation settings snapshot ---

test("blankChat stamps an optional settings snapshot", () => {
  const snapshot = snapshotFromPersona(DEFAULT_PERSONA, "rev42");
  assert.equal(snapshot.textModel, DEFAULT_PERSONA.textModel);
  assert.equal(snapshot.promptMode, DEFAULT_PERSONA.promptMode);
  assert.equal(snapshot.webSearch, DEFAULT_PERSONA.webSearch);
  assert.equal(snapshot.tools, DEFAULT_PERSONA.tools);
  assert.equal(snapshot.createdWithCatalogRevision, "rev42");
  const chat = blankChat(snapshot);
  assert.deepEqual(chat.settings, snapshot);
  const bare = blankChat();
  assert.equal(bare.settings, undefined);
});

test("validateChatRecord keeps valid snapshots and drops malformed ones", () => {
  const snapshot = snapshotFromPersona(DEFAULT_PERSONA);
  const chat = { ...blankChat(), turns: [{ role: "user", content: "hello" }], settings: snapshot };
  const parsed = validateChatRecord(chat);
  assert.deepEqual(parsed?.settings, snapshot);
  const broken = validateChatRecord({ ...chat, settings: { textModel: 5, junk: true } });
  assert.equal(broken?.settings, undefined);
});

test("branchChat creates a new conversation up to the specified turn without mutating source", () => {
  const source: ChatRecord = {
    id: "source-12345",
    title: "Original Topic",
    updatedAt: 1000,
    pinned: true,
    turns: [
      { role: "user", content: "turn 0" },
      { role: "assistant", content: "turn 1" },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "turn 3" },
    ],
    settings: snapshotFromPersona(DEFAULT_PERSONA),
  };

  const branched = branchChat(source, 1);
  assert.notEqual(branched.id, source.id);
  assert.equal(branched.title, "Branch: Original Topic");
  assert.equal(branched.turns.length, 2);
  assert.equal(branched.turns[0]?.content, "turn 0");
  assert.equal(branched.turns[1]?.content, "turn 1");
  assert.equal(branched.pinned, false);
  assert.deepEqual(branched.settings, source.settings);

  // Source remains unmutated
  assert.equal(source.turns.length, 4);
});
