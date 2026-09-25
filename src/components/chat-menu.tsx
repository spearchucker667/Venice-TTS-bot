import { useEffect, useRef, useState } from "react";
import type { ChatRecord } from "@/chats";
import { IMPORT_LIMITS } from "@/chat-export";
import {
  estimateStorageBytes,
  firstUserPreview,
  formatBytes,
  formatStamp,
  groupChats,
  searchHistory,
  type HistoryMatch,
} from "@/history-search";

const RENAME_MAX = 48;
const SEARCH_DEBOUNCE_MS = 200;
const CLEAR_CONFIRM_MS = 5000;

export type DeleteToast = { id: string; title: string } | null;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (!value) {
      setDebounced(value);
      return;
    }
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ChatMenu({
  chats,
  activeId,
  query,
  onQuery,
  onOpen,
  onNew,
  onRename,
  onDelete,
  onPin,
  onExport,
  onImport,
  onOpenSettings,
  onClearAll,
  onExportChat,
  onApplyDefaults,
  notice,
  onDismissNotice,
  deleteToast,
  onUndoDelete,
  onDismissDelete,
  incognito = false,
  onToggleIncognito,
}: {
  chats: ChatRecord[];
  activeId: string;
  query: string;
  onQuery: (value: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onOpenSettings: (tab: "connection" | "model" | "persona" | "voice" | "tools" | "changer") => void;
  onClearAll: () => void;
  onExportChat?: (id: string) => void;
  onApplyDefaults?: (id: string) => void;
  notice?: string;
  onDismissNotice?: () => void;
  deleteToast?: DeleteToast;
  onUndoDelete?: () => void;
  onDismissDelete?: () => void;
  incognito?: boolean;
  onToggleIncognito?: (value: boolean) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [importError, setImportError] = useState("");
  const renameSourceRef = useRef<HTMLButtonElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const needle = debouncedQuery.toLowerCase();
  const searching = needle.length > 0;
  const matches = searching ? searchHistory(chats, debouncedQuery) : [];
  const groups = searching ? [] : groupChats(chats);

  useEffect(() => {
    if (deleteToast) undoRef.current?.focus();
  }, [deleteToast]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), CLEAR_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const beginRename = (chat: ChatRecord, source: HTMLButtonElement | null) => {
    renameSourceRef.current = source;
    setDraft(chat.title);
    setRenamingId(chat.id);
  };

  const cancelRename = () => {
    setRenamingId(null);
    renameSourceRef.current?.focus();
  };

  const commitRename = () => {
    const id = renamingId;
    const title = draft.trim();
    setRenamingId(null);
    renameSourceRef.current?.focus();
    if (id && title) onRename(id, title);
  };

  const metaLine = (chat: ChatRecord, match?: HistoryMatch): string => {
    if (match) {
      const field = match.field === "title" ? "Title" : match.field === "user" ? "You" : "Ember";
      return `${field}: ${match.snippet}`;
    }
    const preview = firstUserPreview(chat.turns);
    return `${formatStamp(chat.updatedAt)}${preview ? ` · ${preview}` : " · No messages yet"}`;
  };

  const renderRow = (chat: ChatRecord, match?: HistoryMatch) => (
    <div
      key={chat.id}
      className="menu-row"
      role="listitem"
      data-active={chat.id === activeId ? "true" : "false"}
    >
      {renamingId === chat.id ? (
        <form
          className="edit-row"
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <label className="field-hint" htmlFor={`rename-${chat.id}`}>
            Rename chat
          </label>
          <input
            id={`rename-${chat.id}`}
            autoFocus
            value={draft}
            maxLength={RENAME_MAX}
            aria-label="Chat title"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={cancelRename}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="menu-open" onClick={() => onOpen(chat.id)}>
          <span>
            {chat.pinned ? "Pinned · " : ""}
            {chat.title}
          </span>
          <span className="hint">{metaLine(chat, match)}</span>
        </button>
      )}
      {renamingId === chat.id ? null : (
        <div className="menu-row-actions">
          <button
            type="button"
            aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
            onClick={() => onPin(chat.id)}
          >
            {chat.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            aria-label={`Rename chat ${chat.title}`}
            onClick={(event) => beginRename(chat, event.currentTarget)}
          >
            Rename
          </button>
          {chat.settings && onApplyDefaults ? (
            <button
              type="button"
              aria-label={`Apply current defaults to ${chat.title}`}
              onClick={() => onApplyDefaults(chat.id)}
            >
              Defaults
            </button>
          ) : null}
          {onExportChat ? (
            <button
              type="button"
              aria-label={`Export ${chat.title}`}
              onClick={() => onExportChat(chat.id)}
            >
              Export
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Delete chat ${chat.title}`}
            onClick={() => onDelete(chat.id)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="menu">
      <div className="menu-head">
        <button type="button" className="primary menu-new" onClick={onNew}>
          New chat
        </button>
        <input
          suppressHydrationWarning
          aria-label="Search chats"
          placeholder="Search chats"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      {incognito ? (
        <p className="hint" role="status">
          Incognito: new turns stay in memory only.
        </p>
      ) : null}
      {notice ? (
        <p className="hint" role="status">
          {notice}{" "}
          {onDismissNotice ? (
            <button type="button" aria-label="Dismiss notice" onClick={onDismissNotice}>
              Dismiss
            </button>
          ) : null}
        </p>
      ) : null}
      {importError ? (
        <p className="hint" role="alert">
          {importError}
        </p>
      ) : null}
      <div className="menu-list" role="list">
        {searching
          ? matches.map((match) => {
              const chat = chats.find((row) => row.id === match.chatId);
              if (!chat) return null;
              return renderRow(chat, match);
            })
          : groups.map((group) => (
              <section className="group" key={group.id}>
                <h3>{group.label}</h3>
                {group.chats.map((chat) => renderRow(chat))}
              </section>
            ))}
        {searching && matches.length === 0 ? <p className="hint">No chats match.</p> : null}
        {!searching && chats.length === 0 ? (
          <p className="hint">Chats stay in this browser.</p>
        ) : null}
      </div>
      <div className="menu-links">
        <button type="button" onClick={onExport}>
          Export all
        </button>
        <label className="file-btn">
          Import
          <input
            type="file"
            accept="application/json"
            aria-label="Import chats"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > IMPORT_LIMITS.maxFileBytes) {
                setImportError(
                  `That file is ${formatBytes(file.size)}; imports are capped at ${formatBytes(
                    IMPORT_LIMITS.maxFileBytes,
                  )}. Pick a smaller export.`,
                );
                return;
              }
              setImportError("");
              onImport(file);
            }}
          />
        </label>
        <span className="hint" aria-label="History storage size">
          {formatBytes(estimateStorageBytes(chats))} of history
        </span>
      </div>
      <div className="menu-links">
        <button
          type="button"
          aria-pressed={incognito}
          onClick={() => onToggleIncognito?.(!incognito)}
        >
          {incognito ? "Incognito: on" : "Incognito: off"}
        </button>
        <button type="button" onClick={() => setConfirmClear(true)}>
          Clear all local chats
        </button>
        <button type="button" onClick={() => onOpenSettings("connection")}>
          Settings
        </button>
      </div>
      <div className="menu-links">
        <button type="button" onClick={() => onOpenSettings("persona")}>
          Characters
        </button>
        <button type="button" onClick={() => onOpenSettings("voice")}>
          TTS studio
        </button>
        <button type="button" onClick={() => onOpenSettings("changer")}>
          Voice changer
        </button>
        <button type="button" onClick={() => onOpenSettings("model")}>
          Model controls
        </button>
      </div>
      {confirmClear && !deleteToast ? (
        <div className="confirm" role="alertdialog" aria-label="Clear all local chats">
          <p>Delete every local conversation? This cannot be undone.</p>
          <div className="confirm-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setConfirmClear(false);
                onClearAll();
              }}
            >
              Delete all
            </button>
            <button type="button" onClick={() => setConfirmClear(false)}>
              Keep them
            </button>
          </div>
        </div>
      ) : null}
      {deleteToast ? (
        <div className="confirm" role="status" aria-live="polite">
          <p>
            Deleted “{deleteToast.title}”. <span className="hint">Undo is available briefly.</span>
          </p>
          <div className="confirm-actions">
            <button ref={undoRef} type="button" className="primary" onClick={onUndoDelete}>
              Undo
            </button>
            <button type="button" onClick={onDismissDelete}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
