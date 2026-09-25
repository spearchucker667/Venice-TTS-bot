import type { Turn } from "@/state";

export type ChatRecord = {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  turns: Turn[];
};

const DB = "ember-chats";
const STORE = "chats";

export function titleFromTurns(turns: Turn[]): string {
  const first = turns.find((turn) => turn.role === "user")?.content ?? "";
  const title = first.replace(/\s+/g, " ").trim().slice(0, 48);
  return title || "New chat";
}

export function chatId(): string {
  return crypto.randomUUID();
}

export function blankChat(): ChatRecord {
  return { id: chatId(), title: "New chat", updatedAt: Date.now(), pinned: false, turns: [] };
}

export function sortChats(rows: ChatRecord[]): ChatRecord[] {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
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

export async function listChats(): Promise<ChatRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getAll();
  const rows = await new Promise<ChatRecord[]>((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as ChatRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return sortChats(rows);
}

export async function saveChat(chat: ChatRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(chat);
  await txDone(tx);
  db.close();
}

export async function deleteChat(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}

export async function clearChats(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await txDone(tx);
  db.close();
}

function asTurn(value: unknown): Turn | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    role?: unknown;
    content?: unknown;
    tool_call_id?: unknown;
    name?: unknown;
  };
  if (typeof row.content !== "string") return null;
  if (row.role === "user") return { role: "user", content: row.content.slice(0, 20000) };
  if (row.role === "assistant") return { role: "assistant", content: row.content.slice(0, 20000) };
  if (row.role === "tool" && typeof row.tool_call_id === "string" && typeof row.name === "string") {
    return {
      role: "tool",
      content: row.content.slice(0, 20000),
      tool_call_id: row.tool_call_id.slice(0, 80),
      name: row.name.slice(0, 80),
    };
  }
  return null;
}

export function parseChatExport(json: unknown): ChatRecord[] {
  const root = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? (json as { chats?: unknown }).chats
      : null;
  if (!Array.isArray(root)) return [];
  const out: ChatRecord[] = [];
  for (const item of root.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      id?: unknown;
      title?: unknown;
      updatedAt?: unknown;
      pinned?: unknown;
      turns?: unknown;
    };
    const turns = Array.isArray(row.turns)
      ? row.turns
          .map(asTurn)
          .filter((turn): turn is Turn => Boolean(turn))
          .slice(-80)
      : [];
    if (!turns.length && (typeof row.title !== "string" || !row.title.trim())) continue;
    out.push({
      id: typeof row.id === "string" && row.id.length > 8 && row.id.length < 80 ? row.id : chatId(),
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
    });
  }
  return sortChats(out);
}
