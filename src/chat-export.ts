import {
  chatId,
  repairToolTransactions,
  sortChats,
  titleFromTurns,
  validateTurn,
  type ChatRecord,
} from "./chats.ts";
import type { Turn } from "./state.ts";

export const CHAT_EXPORT_VERSION = 1;

/** Generous but finite import caps (CHAT-006). */
export const IMPORT_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxChats: 200,
  maxTurnsPerChat: 400,
} as const;

export type ChatExportV1 = {
  version: 1;
  exportedAt: string;
  chats: ChatRecord[];
};

export function buildChatExport(
  chats: ChatRecord[],
  exportedAt: string = new Date().toISOString(),
): ChatExportV1 {
  return { version: CHAT_EXPORT_VERSION, exportedAt, chats };
}

export class ChatExportVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(
      `Unsupported chat export version ${version}. This version of Ember reads version ${CHAT_EXPORT_VERSION} exports.`,
    );
    this.name = "ChatExportVersionError";
    this.version = version;
  }
}

/**
 * Detect the export version. Legacy exports (a bare array or an unversioned
 * `{ chats: [...] }` wrapper) are version 1. Returns null when the input is
 * not a chat export at all.
 */
export function parseExportVersion(json: unknown): number | null {
  if (Array.isArray(json)) return 1;
  if (!json || typeof json !== "object") return null;
  const wrapper = json as { version?: unknown; chats?: unknown };
  if (wrapper.version === undefined) {
    return Array.isArray(wrapper.chats) ? 1 : null;
  }
  return typeof wrapper.version === "number" && Number.isFinite(wrapper.version)
    ? wrapper.version
    : null;
}

export type ChatImportSummary = {
  imported: number;
  /** Rows skipped as invalid or empty. */
  skipped: number;
  /** Rows whose id collided with an existing chat and were given a fresh id. */
  idConflicts: number;
  /** Turns dropped because they failed turn validation. */
  droppedTurns: number;
  /** Malformed tool transactions converted to safe textual archival records. */
  archivedTransactions: number;
  /** Orphan tool-result turns removed (no matching assistant tool call). */
  droppedOrphanTools: number;
  /** True when a cap (chat count or turns per chat) trimmed the import. */
  truncated: boolean;
};

export type ChatImportResult = {
  chats: ChatRecord[];
  summary: ChatImportSummary;
};

function freshSummary(): ChatImportSummary {
  return {
    imported: 0,
    skipped: 0,
    idConflicts: 0,
    droppedTurns: 0,
    archivedTransactions: 0,
    droppedOrphanTools: 0,
    truncated: false,
  };
}

function exportRoot(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object" && Array.isArray((json as { chats?: unknown }).chats)) {
    return (json as { chats: unknown[] }).chats;
  }
  return null;
}

function parseChatRow(
  item: unknown,
  existingIds: ReadonlySet<string> | undefined,
  summary: ChatImportSummary,
): ChatRecord | null {
  if (!item || typeof item !== "object") return null;
  const row = item as {
    id?: unknown;
    title?: unknown;
    updatedAt?: unknown;
    pinned?: unknown;
    turns?: unknown;
  };
  if (!Array.isArray(row.turns)) return null;
  let turns = row.turns
    .map((raw) => {
      const turn = validateTurn(raw);
      if (!turn) summary.droppedTurns += 1;
      return turn;
    })
    .filter((turn): turn is Turn => turn !== null);
  if (turns.length > IMPORT_LIMITS.maxTurnsPerChat) {
    turns = turns.slice(-IMPORT_LIMITS.maxTurnsPerChat);
    summary.truncated = true;
  }
  turns = repairToolTransactions(turns, summary);
  const hasTitle = typeof row.title === "string" && row.title.trim().length > 0;
  if (!turns.length && !hasTitle) return null;
  let id =
    typeof row.id === "string" && row.id.length > 8 && row.id.length < 80 ? row.id : chatId();
  if (existingIds?.has(id)) {
    id = chatId();
    summary.idConflicts += 1;
  }
  return {
    id,
    title: hasTitle ? (row.title as string).trim().slice(0, 48) : titleFromTurns(turns),
    updatedAt:
      typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : Date.now(),
    pinned: row.pinned === true,
    turns,
  };
}

function parseV1(json: unknown, existingIds?: ReadonlySet<string>): ChatImportResult {
  const root = exportRoot(json);
  const summary = freshSummary();
  if (!root) return { chats: [], summary };
  let rows = root;
  if (rows.length > IMPORT_LIMITS.maxChats) {
    rows = rows.slice(0, IMPORT_LIMITS.maxChats);
    summary.truncated = true;
  }
  const chats: ChatRecord[] = [];
  for (const item of rows) {
    const chat = parseChatRow(item, existingIds, summary);
    if (chat) {
      chats.push(chat);
      summary.imported += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return { chats: sortChats(chats), summary };
}

/** Version 1 is the current schema; migration normalizes and repairs rows. */
export function migrateV1ToCurrent(json: unknown, existingIds?: ReadonlySet<string>): ChatRecord[] {
  return parseV1(json, existingIds).chats;
}

/**
 * Parse a chat export. Legacy/unversioned inputs are treated as version 1.
 * Throws ChatExportVersionError for newer, incompatible versions (CHAT-004).
 */
export function parseChatImport(
  json: unknown,
  existingIds?: ReadonlySet<string>,
): ChatImportResult {
  const version = parseExportVersion(json);
  if (version === null) return { chats: [], summary: freshSummary() };
  if (version !== CHAT_EXPORT_VERSION) throw new ChatExportVersionError(version);
  return parseV1(json, existingIds);
}

/** Backward-compatible wrapper returning only the parsed chats. */
export function parseChatExport(json: unknown, existingIds?: ReadonlySet<string>): ChatRecord[] {
  return parseChatImport(json, existingIds).chats;
}
