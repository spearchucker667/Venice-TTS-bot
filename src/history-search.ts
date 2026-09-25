import type { ChatRecord } from "./chats.ts";
import type { Turn } from "./state.ts";

/** Debounce window for the history search input. */
export const HISTORY_SEARCH_DEBOUNCE_MS = 200;

const SNIPPET_MAX = 120;
const PREVIEW_MAX = 72;
const DAY_MS = 86400000;

/** First user message, flattened and capped, for list previews. */
export function firstUserPreview(turns: Turn[], maxLength = PREVIEW_MAX): string {
  const first = turns.find((turn) => turn.role === "user");
  const clean = (first?.content ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function snippetAround(text: string, needle: string, maxLength = SNIPPET_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const at = clean.toLowerCase().indexOf(needle);
  if (at < 0) return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
  const half = Math.floor(maxLength / 2);
  const start = Math.max(0, at - half);
  const end = Math.min(clean.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

export type HistoryMatchField = "title" | "user" | "assistant";

export type HistoryMatch = {
  chatId: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
  field: HistoryMatchField;
  snippet: string;
};

/**
 * Local, dependency-free history search over title + user + assistant text
 * (CHAT-007). Case-insensitive, one best match per chat, capped snippets.
 * Nothing leaves the browser: the index is built lazily per query.
 */
export function searchHistory(chats: ChatRecord[], query: string, limit = 20): HistoryMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: HistoryMatch[] = [];
  for (const chat of chats) {
    const base = {
      chatId: chat.id,
      title: chat.title,
      pinned: chat.pinned,
      updatedAt: chat.updatedAt,
    };
    let match: HistoryMatch | null = null;
    if (chat.title.toLowerCase().includes(needle)) {
      match = { ...base, field: "title", snippet: snippetAround(chat.title, needle) };
    } else {
      for (const turn of chat.turns) {
        if (turn.role !== "user" && turn.role !== "assistant") continue;
        if (!turn.content.toLowerCase().includes(needle)) continue;
        match = {
          ...base,
          field: turn.role,
          snippet: snippetAround(turn.content, needle),
        };
        break;
      }
    }
    if (match) matches.push(match);
  }
  matches.sort((a, b) => b.updatedAt - a.updatedAt);
  return matches.slice(0, limit);
}

export type HistoryGroupId = "today" | "yesterday" | "week" | "older";

export type HistoryGroup = {
  id: HistoryGroupId;
  label: string;
  chats: ChatRecord[];
};

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Group a sorted chat list into Today / Yesterday / Previous 7 days / Older. */
export function groupChats(chats: ChatRecord[], now = Date.now()): HistoryGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 7 * DAY_MS;
  const buckets: Record<HistoryGroupId, ChatRecord[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const chat of chats) {
    if (chat.updatedAt >= todayStart) buckets.today.push(chat);
    else if (chat.updatedAt >= yesterdayStart) buckets.yesterday.push(chat);
    else if (chat.updatedAt >= weekStart) buckets.week.push(chat);
    else buckets.older.push(chat);
  }
  return (
    [
      { id: "today" as const, label: "Today", chats: buckets.today },
      { id: "yesterday" as const, label: "Yesterday", chats: buckets.yesterday },
      { id: "week" as const, label: "Previous 7 days", chats: buckets.week },
      { id: "older" as const, label: "Older", chats: buckets.older },
    ] satisfies HistoryGroup[]
  ).filter((group) => group.chats.length > 0);
}

/** Compact last-updated stamp: clock time today, weekday this week, date older. */
export function formatStamp(ts: number, now = Date.now()): string {
  const todayStart = startOfDay(now);
  if (ts >= todayStart) {
    const date = new Date(ts);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (ts >= todayStart - DAY_MS) return "Yesterday";
  if (ts >= todayStart - 7 * DAY_MS) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  }
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Cheap local storage estimate (JSON length), never sent anywhere. */
export function estimateStorageBytes(chats: ChatRecord[]): number {
  let total = 0;
  for (const chat of chats) total += JSON.stringify(chat).length;
  return total;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
