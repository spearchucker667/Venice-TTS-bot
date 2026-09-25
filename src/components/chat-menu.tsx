import type { ChatRecord } from "@/chats";

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
}) {
  const needle = query.trim().toLowerCase();
  const shown = needle ? chats.filter((chat) => chat.title.toLowerCase().includes(needle)) : chats;
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
      <div className="menu-list" role="list">
        {shown.map((chat) => (
          <div
            key={chat.id}
            className="menu-row"
            role="listitem"
            data-active={chat.id === activeId ? "true" : "false"}
          >
            <button type="button" className="menu-open" onClick={() => onOpen(chat.id)}>
              <span>
                {chat.pinned ? "Pinned · " : ""}
                {chat.title}
              </span>
            </button>
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
                aria-label="Rename chat"
                onClick={() => {
                  const title = window.prompt("Rename chat", chat.title);
                  if (title != null) onRename(chat.id, title);
                }}
              >
                Rename
              </button>
              <button type="button" aria-label="Delete chat" onClick={() => onDelete(chat.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {shown.length === 0 ? (
          <p className="hint">{needle ? "No chats match." : "Chats stay in this browser."}</p>
        ) : null}
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
        <button type="button" onClick={() => onOpenSettings("connection")}>
          Settings
        </button>
      </div>
      <div className="menu-links">
        <button type="button" onClick={onExport}>
          Export
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
              if (file) onImport(file);
            }}
          />
        </label>
        <button type="button" onClick={onClearAll}>
          Clear all local chats
        </button>
      </div>
    </div>
  );
}
