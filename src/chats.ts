import type { Citation, Persona, PromptMode, SearchMode, ToolCall, Turn } from "@/state";

/** Per-conversation snapshot of the semantic settings a chat was created with. */
export type ChatSettingsSnapshot = {
  textModel: string;
  systemPrompt: string;
  promptMode: PromptMode;
  characterSlug: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoningEffort?: string;
  webSearch: SearchMode;
  tools: boolean;
  createdWithCatalogRevision?: string;
};

export type ChatRecord = {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  turns: Turn[];
  settings?: ChatSettingsSnapshot;
};

const DB = "ember-chats";
const STORE = "chats";
const MAX_ID_LENGTH = 80;
const MIN_ID_LENGTH = 8;
const MAX_TURN_TEXT = 20000;
const MAX_THINKING_TEXT = 32768;
const MAX_TOOL_CALLS_PER_TURN = 32;
const MAX_TOOL_ARGUMENTS = 16384;
const MAX_CITATIONS_PER_TURN = 24;

export function titleFromTurns(turns: Turn[]): string {
  const first = turns.find((turn) => turn.role === "user")?.content ?? "";
  const title = first.replace(/\s+/g, " ").trim().slice(0, 48);
  return title || "New chat";
}

export function chatId(): string {
  return crypto.randomUUID();
}

export function snapshotFromPersona(
  persona: Persona,
  catalogRevision?: string,
): ChatSettingsSnapshot {
  const snapshot: ChatSettingsSnapshot = {
    textModel: persona.textModel,
    systemPrompt: persona.systemPrompt,
    promptMode: persona.promptMode,
    characterSlug: persona.characterSlug,
    temperature: persona.temperature,
    topP: persona.topP,
    maxTokens: persona.maxTokens,
    webSearch: persona.webSearch,
    tools: persona.tools,
  };
  if (catalogRevision) snapshot.createdWithCatalogRevision = catalogRevision;
  return snapshot;
}

export function blankChat(settings?: ChatSettingsSnapshot): ChatRecord {
  const chat: ChatRecord = {
    id: chatId(),
    title: "New chat",
    updatedAt: Date.now(),
    pinned: false,
    turns: [],
  };
  if (settings) chat.settings = settings;
  return chat;
}

export function sortChats(rows: ChatRecord[]): ChatRecord[] {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

// --- Canonical runtime validation (CHAT-005): local persistence is not trusted ---

function isCitation(value: unknown): value is Citation {
  if (!value || typeof value !== "object") return false;
  const row = value as { title?: unknown; url?: unknown };
  return typeof row.title === "string" && typeof row.url === "string";
}

function isToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== "object") return false;
  const row = value as { id?: unknown; name?: unknown; arguments?: unknown };
  return (
    typeof row.id === "string" && typeof row.name === "string" && typeof row.arguments === "string"
  );
}

/** Validate one raw turn against the canonical Turn schema, capping oversized fields. */
export function validateTurn(value: unknown): Turn | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    role?: unknown;
    content?: unknown;
    thinking?: unknown;
    tool_calls?: unknown;
    citations?: unknown;
    tool_call_id?: unknown;
    name?: unknown;
  };
  if (typeof row.content !== "string") return null;
  const content = row.content.slice(0, MAX_TURN_TEXT);
  if (row.role === "user") return { role: "user", content };
  if (row.role === "assistant") {
    const turn: Extract<Turn, { role: "assistant" }> = { role: "assistant", content };
    if (typeof row.thinking === "string") turn.thinking = row.thinking.slice(0, MAX_THINKING_TEXT);
    if (Array.isArray(row.citations)) {
      const citations = row.citations
        .filter(isCitation)
        .slice(0, MAX_CITATIONS_PER_TURN)
        .map((citation) => ({
          title: citation.title.slice(0, 200),
          url: citation.url.slice(0, 500),
        }));
      if (citations.length) turn.citations = citations;
    }
    if (Array.isArray(row.tool_calls)) {
      const calls = row.tool_calls
        .filter(isToolCall)
        .slice(0, MAX_TOOL_CALLS_PER_TURN)
        .map((call) => ({
          id: call.id.slice(0, 80),
          name: call.name.slice(0, 80),
          arguments: call.arguments.slice(0, MAX_TOOL_ARGUMENTS),
        }));
      if (calls.length) turn.tool_calls = calls;
    }
    return turn;
  }
  if (row.role === "tool" && typeof row.tool_call_id === "string" && typeof row.name === "string") {
    return {
      role: "tool",
      content,
      tool_call_id: row.tool_call_id.slice(0, 80),
      name: row.name.slice(0, 80),
    };
  }
  return null;
}

/**
 * CHAT-001 / 22.4: Validate whole tool transactions atomically.
 * Preserves complete transactions, safely archives incomplete tool calls,
 * and strips orphan tool result turns.
 */
export function repairToolTransactions(
  turns: Turn[],
  summary?: { droppedOrphanTools?: number; archivedTransactions?: number },
): Turn[] {
  const out: Turn[] = [];
  let index = 0;
  while (index < turns.length) {
    const turn = turns[index] as Turn;
    if (turn.role === "tool") {
      if (summary && typeof summary.droppedOrphanTools === "number") {
        summary.droppedOrphanTools += 1;
      }
      index += 1;
      continue;
    }
    if (turn.role === "assistant" && turn.tool_calls?.length) {
      const calls = turn.tool_calls;
      const pending = new Set(calls.map((call) => call.id));
      let cursor = index + 1;
      let contiguous = true;
      const consumed: (Turn & { role: "tool" })[] = [];
      while (cursor < turns.length && pending.size > 0) {
        const next = turns[cursor] as Turn;
        if (next.role !== "tool") break;
        if (!pending.has(next.tool_call_id)) {
          contiguous = false;
          break;
        }
        pending.delete(next.tool_call_id);
        consumed.push(next);
        cursor += 1;
      }
      if (contiguous && pending.size === 0 && consumed.length === calls.length) {
        out.push(turn, ...consumed);
      } else {
        if (summary && typeof summary.archivedTransactions === "number") {
          summary.archivedTransactions += 1;
        }
        const names = calls
          .map((call) => call.name)
          .filter(Boolean)
          .join(", ");
        const note = `[archived incomplete tool call${
          calls.length === 1 ? "" : "s"
        }: ${names || "unknown"} — results omitted for safety]`;
        const archived: Turn = {
          role: "assistant",
          content: turn.content ? `${turn.content}\n\n${note}` : note,
        };
        if (turn.thinking) archived.thinking = turn.thinking;
        if (turn.citations?.length) archived.citations = turn.citations;
        out.push(archived);
      }
      index = cursor;
      continue;
    }
    out.push(turn);
    index += 1;
  }
  return out;
}

/**
 * 22.4: Branch from a turn into a new local conversation.
 * Copies history up to the selected turn atomically, ensuring no orphan tool results
 * and no mutation of the source conversation.
 */
export function branchChat(sourceChat: ChatRecord, upToTurnIndex: number): ChatRecord {
  const boundedIndex = Math.max(0, Math.min(upToTurnIndex, sourceChat.turns.length - 1));
  const slice = sourceChat.turns.slice(0, boundedIndex + 1);
  const turns = repairToolTransactions(slice);
  const baseTitle = (sourceChat.title || "Chat").replace(/^Branch:\s*/, "");
  const title = `Branch: ${baseTitle}`.slice(0, 48);
  return {
    id: chatId(),
    title,
    updatedAt: Date.now(),
    pinned: false,
    turns,
    settings: sourceChat.settings ? { ...sourceChat.settings } : undefined,
  };
}

function asPromptMode(value: unknown): PromptMode | null {
  return value === "persona" || value === "character" || value === "blend" ? value : null;
}

function asSearchMode(value: unknown): SearchMode | null {
  return value === "off" || value === "auto" || value === "on" ? value : null;
}

function validateSettings(value: unknown): ChatSettingsSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as {
    textModel?: unknown;
    systemPrompt?: unknown;
    promptMode?: unknown;
    characterSlug?: unknown;
    temperature?: unknown;
    topP?: unknown;
    maxTokens?: unknown;
    reasoningEffort?: unknown;
    webSearch?: unknown;
    tools?: unknown;
    createdWithCatalogRevision?: unknown;
  };
  if (typeof row.textModel !== "string" || typeof row.systemPrompt !== "string") return undefined;
  const promptMode = asPromptMode(row.promptMode);
  const webSearch = asSearchMode(row.webSearch);
  if (!promptMode || !webSearch) return undefined;
  if (
    typeof row.temperature !== "number" ||
    !Number.isFinite(row.temperature) ||
    typeof row.topP !== "number" ||
    !Number.isFinite(row.topP) ||
    typeof row.maxTokens !== "number" ||
    !Number.isFinite(row.maxTokens)
  ) {
    return undefined;
  }
  const snapshot: ChatSettingsSnapshot = {
    textModel: row.textModel.slice(0, 120),
    systemPrompt: row.systemPrompt.slice(0, 8000),
    promptMode,
    characterSlug: typeof row.characterSlug === "string" ? row.characterSlug.slice(0, 80) : "",
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: Math.round(row.maxTokens),
    webSearch,
    tools: typeof row.tools === "boolean" ? row.tools : true,
  };
  if (typeof row.reasoningEffort === "string") snapshot.reasoningEffort = row.reasoningEffort;
  if (typeof row.createdWithCatalogRevision === "string") {
    snapshot.createdWithCatalogRevision = row.createdWithCatalogRevision.slice(0, 40);
  }
  return snapshot;
}

/** Validate one raw IndexedDB row. Returns null when the row must be quarantined. */
export function validateChatRecord(value: unknown): ChatRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    id?: unknown;
    title?: unknown;
    updatedAt?: unknown;
    pinned?: unknown;
    turns?: unknown;
    settings?: unknown;
  };
  if (
    typeof row.id !== "string" ||
    row.id.length <= MIN_ID_LENGTH ||
    row.id.length >= MAX_ID_LENGTH
  ) {
    return null;
  }
  if (!Array.isArray(row.turns)) return null;
  const turns = row.turns
    .map(validateTurn)
    .filter((turn): turn is Turn => turn !== null)
    .slice(-400);
  const settings = validateSettings(row.settings);
  const chat: ChatRecord = {
    id: row.id,
    title:
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, 48)
        : titleFromTurns(turns),
    updatedAt:
      typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : Date.now(),
    pinned: row.pinned === true,
    turns,
  };
  if (settings) chat.settings = settings;
  return chat;
}

// --- Serialized write queue (CHAT-002): a stale in-flight save can never
// resurrect a chat that was deleted or cleared after the save was queued. ---

let writeSeq = 0;
let lastClearSeq = 0;
const invalidatedAt = new Map<string, number>();
let writeTail: Promise<void> = Promise.resolve();

function enqueueWrite(run: () => Promise<void>): Promise<void> {
  const next = writeTail.then(run, run);
  writeTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function idbGetAll(): Promise<unknown[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return rows;
  } finally {
    db.close();
  }
}

async function idbPut(chat: ChatRecord, isStale?: () => boolean): Promise<void> {
  const db = await openDb();
  try {
    // Re-check right before the transaction is created: this is the closest
    // point to the actual write a queued task can observe.
    if (isStale?.()) return;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(chat);
    await txDone(tx);
  } finally {
    db.close();
  }
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** Queue a put. Saves queued before a later delete/clear of the same id are skipped. */
export function saveChat(chat: ChatRecord): Promise<void> {
  const seq = ++writeSeq;
  const stale = () => {
    if (seq < lastClearSeq) return true;
    const deadAt = invalidatedAt.get(chat.id);
    return deadAt !== undefined && seq < deadAt;
  };
  return enqueueWrite(async () => {
    if (stale()) return;
    await idbPut(chat, stale);
  });
}

/** Queue a delete. Invalidates saves for this id that were queued earlier. */
export function deleteChat(id: string): Promise<void> {
  invalidatedAt.set(id, ++writeSeq);
  return enqueueWrite(() => idbDelete(id));
}

/** Queue a full clear. Invalidates every save queued earlier. */
export function clearChats(): Promise<void> {
  lastClearSeq = ++writeSeq;
  invalidatedAt.clear();
  return enqueueWrite(() => idbClear());
}

export type ChatListReport = {
  chats: ChatRecord[];
  /** Rows skipped by the quarantine policy (invalid records, never thrown). */
  quarantined: number;
};

export async function listChatsDetailed(): Promise<ChatListReport> {
  const raw = await idbGetAll();
  const chats: ChatRecord[] = [];
  let quarantined = 0;
  for (const row of raw) {
    const chat = validateChatRecord(row);
    if (chat) chats.push(chat);
    else quarantined += 1;
  }
  return { chats: sortChats(chats), quarantined };
}

export async function listChats(): Promise<ChatRecord[]> {
  return (await listChatsDetailed()).chats;
}
