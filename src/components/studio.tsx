import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Menu, Mic, Send, Settings, Square, X } from "lucide-react";
import { ChatMenu } from "@/components/chat-menu";
import { MicCalibration } from "@/components/mic-calibration";
import { Orb } from "@/components/orb";
import { RichText } from "@/components/rich-text";
import { VoiceChanger } from "@/components/voice-changer";
import { classifyAppError } from "@/errors";
import { presentText } from "@/speech";
import { isTypingOrInteractiveTarget } from "@/vad";
import {
  DEFAULT_PROMPT,
  FLOWS,
  LAMPS,
  PRESETS,
  PROMPT_PRESETS,
  STT_FALLBACK,
  TTS_FALLBACK,
  estimateTokens,
  flowById,
  lampById,
  visual,
  type FlowId,
  type LampId,
  type PresetId,
  type PromptMode,
  type SearchMode,
  type ThinkingMode,
  type Turn,
} from "@/state";
import {
  applyThemeToDom,
  loadAppearance,
  saveAppearance,
  DEFAULT_APPEARANCE,
  THEME_FAMILIES,
  THEME_PREVIEWS,
  ORB_SHAPES,
  type AppearanceSettings,
} from "@/theme";
import { useEmber, voicesFor } from "@/use-ember";
import { resolveTextModel, traitChoices, type Balance } from "@/venice";

const SETTINGS_TABS = [
  ["connection", "Key"],
  ["model", "Model"],
  ["persona", "Persona"],
  ["voice", "Voice"],
  ["tools", "Tools"],
  ["appearance", "Appearance"],
  ["changer", "Changer"],
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number][0];

const SUGGESTIONS = [
  "What can you actually do?",
  "Think out loud about a private thought",
  "Look up something happening this week",
];

function money(balance: Balance): string | null {
  if (balance.usd) {
    const n = Number(balance.usd);
    if (Number.isFinite(n)) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    }
  }
  if (balance.diem) return `${balance.diem} diem`;
  return null;
}

function withCurrent(
  rows: { id: string; name: string }[],
  current: string,
): { id: string; name: string }[] {
  if (!current || rows.some((row) => row.id === current)) return rows;
  return [{ id: current, name: current }, ...rows];
}

function toolTitle(name: string): string {
  if (name === "venice_web_search") return "Searched the web";
  if (name === "venice_scrape") return "Read a page";
  if (name === "http_request") return "Called an API";
  return name;
}

function Message({ turn, name, actions }: { turn: Turn; name: string; actions?: ReactNode }) {
  if (turn.role === "user") {
    return (
      <article className="msg msg-user">
        <span className="msg-name">You</span>
        <p>{turn.content}</p>
        {actions}
      </article>
    );
  }
  if (turn.role === "tool") {
    return (
      <details className="msg msg-tool">
        <summary>{toolTitle(turn.name)}</summary>
        <p>{turn.content.slice(0, 1200)}</p>
      </details>
    );
  }
  const shown = presentText(turn.content);
  return (
    <article className="msg">
      <span className="msg-name">{name}</span>
      {shown.speech ? <RichText text={shown.speech} /> : null}
      {turn.thinking ? (
        <details className="think">
          <summary>Thought</summary>
          <p>{turn.thinking}</p>
        </details>
      ) : null}
      {turn.citations?.length ? (
        <div className="cites">
          {turn.citations.map((cite) => (
            <a key={cite.url} href={cite.url} target="_blank" rel="noreferrer">
              {cite.title || cite.url}
            </a>
          ))}
        </div>
      ) : null}
      {actions}
    </article>
  );
}

export function Studio() {
  const ember = useEmber();
  const [draft, setDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [tab, setTab] = useState<SettingsTab>("connection");
  const [charQuery, setCharQuery] = useState("");
  const [charHits, setCharHits] = useState<{ slug: string; name: string; description: string }[]>(
    [],
  );
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [studioText, setStudioText] = useState("Hello. This is a voice preview.");
  const [editAt, setEditAt] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [showNewResponse, setShowNewResponse] = useState(false);
  const [charSlugDraft, setCharSlugDraft] = useState(ember.persona.characterSlug);
  const [charSearchError, setCharSearchError] = useState<string | null>(null);
  const [charSearched, setCharSearched] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearance());
  const autoFollowRef = useRef(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const name = ember.persona.name.trim() || "Ember";
  const funds = money(ember.balance);

  useEffect(() => {
    applyThemeToDom(appearance.theme, appearance.mode);
    visual.shape = appearance.orbShape;
    saveAppearance(appearance);
  }, [appearance]);

  const patchAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      saveAppearance(next);
      return next;
    });
  }, []);

  const openSettings = useCallback(
    (next: SettingsTab) => {
      setTab(next);
      ember.setSettingsOpen(true);
      setMenuOpen(false);
    },
    [ember],
  );

  // 22.11 Keyboard command surface
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menuOpen) {
          e.preventDefault();
          setMenuOpen(false);
        } else if (ember.settingsOpen) {
          e.preventDefault();
          ember.setSettingsOpen(false);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !isTypingOrInteractiveTarget(e.target)) {
        const k = e.key.toLowerCase();
        if (k === "k") {
          e.preventDefault();
          openSettings("appearance");
        } else if (k === "n") {
          e.preventDefault();
          ember.startChat();
        } else if (e.key === ",") {
          e.preventDefault();
          openSettings("connection");
        } else if (e.shiftKey && k === "f") {
          e.preventDefault();
          setMenuOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [menuOpen, ember, openSettings]);

  useEffect(() => {
    setCharSlugDraft(ember.persona.characterSlug);
  }, [ember.persona.characterSlug]);

  useEffect(() => {
    visual.lamp = ember.persona.lamp;
    visual.flow = ember.persona.flow;
    document.documentElement.style.setProperty(
      "--lamp",
      LAMPS.find((lamp) => lamp.id === ember.persona.lamp)?.css ?? "#d4653a",
    );
  }, [ember.persona.lamp, ember.persona.flow]);

  const handleThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceToBottom < 80;
    autoFollowRef.current = nearBottom;
    if (nearBottom) {
      setShowNewResponse(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    autoFollowRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowNewResponse(false);
  }, []);

  // UI-001: Auto-follow only when user is already near bottom; show pill otherwise
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (autoFollowRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowNewResponse(false);
    } else if (ember.partial || ember.busy) {
      setShowNewResponse(true);
    }
  }, [ember.turns, ember.partial, ember.hydrated, ember.busy]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (ember.settingsOpen && !el.open) el.showModal();
    if (!ember.settingsOpen && el.open) el.close();
  }, [ember.settingsOpen]);

  useEffect(() => {
    if (!ember.settingsOpen || tab !== "voice" || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        setDevices(
          list
            .filter((device) => device.kind === "audioinput")
            .map((device) => ({ deviceId: device.deviceId, label: device.label || "Microphone" })),
        );
      })
      .catch(() => undefined);
  }, [ember.settingsOpen, tab]);

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void ember.send(text);
  };

  const voices = voicesFor(ember.persona.ttsModel, ember.discovery);
  const textModels = ember.discovery?.text ?? [];
  const ttsModels = withCurrent(
    ember.discovery?.tts.length ? ember.discovery.tts : TTS_FALLBACK,
    ember.persona.ttsModel,
  );
  const sttModels = withCurrent(
    ember.discovery?.asr.length ? ember.discovery.asr : STT_FALLBACK,
    ember.persona.sttModel,
  );
  const resolvedModel = resolveTextModel(ember.persona.textModel, ember.discovery?.traits ?? {});
  const modelRow = textModels.find((row) => row.id === resolvedModel);
  const compat =
    ember.discovery?.compat[ember.persona.ttsModel] ?? ember.discovery?.compat[resolvedModel] ?? [];
  const renderMenu = () => (
    <ChatMenu
      chats={ember.chats}
      activeId={ember.activeChatId}
      query={chatQuery}
      onQuery={setChatQuery}
      onOpen={(id) => {
        ember.openChat(id);
        setMenuOpen(false);
      }}
      onNew={() => {
        ember.startChat();
        setMenuOpen(false);
      }}
      onRename={ember.renameChat}
      onDelete={ember.removeChat}
      onPin={ember.pinChat}
      onExport={ember.exportChats}
      onImport={(file) => void ember.importChats(file)}
      onOpenSettings={openSettings}
      onClearAll={ember.clearAllChats}
      onExportChat={ember.exportChat}
      onApplyDefaults={ember.applyDefaultsToChat}
      notice={ember.notice}
      onDismissNotice={ember.clearNotice}
      deleteToast={ember.deleteToast}
      onUndoDelete={ember.undoDelete}
      onDismissDelete={ember.dismissDeleteToast}
      incognito={ember.incognito}
      onToggleIncognito={ember.setIncognito}
    />
  );
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = -1;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % SETTINGS_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SETTINGS_TABS.length - 1;
    }
    if (nextIndex >= 0) {
      event.preventDefault();
      const nextTab = SETTINGS_TABS[nextIndex]![0];
      setTab(nextTab);
      const tabEl = document.getElementById(`tab-${nextTab}`);
      tabEl?.focus();
    }
  };

  let lastUser = -1;
  ember.turns.forEach((turn, index) => {
    if (turn.role === "user") lastUser = index;
  });

  return (
    <main className="stage">
      <aside className="menu-col">{renderMenu()}</aside>
      {menuOpen ? (
        <div className="drawer-back" onClick={() => setMenuOpen(false)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="Chats">
            <div className="sheet-head">
              <h2>Chats</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close chats"
                onClick={() => setMenuOpen(false)}
              >
                <X className="icon" aria-hidden="true" />
              </button>
            </div>
            {renderMenu()}
          </aside>
        </div>
      ) : null}
      <header className="topbar">
        <div className="brand">
          <p className="brand-kicker">Venice voice</p>
          <h1 className="brand-name">{name}</h1>
        </div>
        <div className="top-actions">
          {funds ? <span className="balance">{funds}</span> : null}
          <button
            type="button"
            className="icon-btn menu-launch"
            aria-label="Chats"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Persona and key"
            onClick={() => ember.setSettingsOpen(true)}
          >
            <Settings className="icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="orb-pane" aria-label="Companion">
        <div className="orb-stack">
          <div className="orb-frame" data-orb-shape={appearance.orbShape}>
            <div className="orb-shadow" />
            <div className="orb-fallback" aria-hidden="true" />
            <Orb shape={appearance.orbShape} />
            <div className="status-block">
              <p className="status-line" aria-live="polite">
                {ember.status}
              </p>
              {ember.persona.thinking === "live" && ember.liveThought ? (
                <p className="thought">{ember.liveThought}</p>
              ) : null}
            </div>
          </div>
          <div className="lamp-picks">
            <div className="swatches" role="group" aria-label="Lamp color">
              {LAMPS.map((lamp) => (
                <button
                  key={lamp.id}
                  type="button"
                  className="swatch"
                  data-lamp={lamp.id}
                  aria-pressed={ember.persona.lamp === lamp.id}
                  aria-label={lamp.name}
                  onClick={() => ember.patchPersona({ lamp: lamp.id satisfies LampId })}
                />
              ))}
            </div>
            <div className="seg lamp-flows" role="group" aria-label="Lamp motion">
              {FLOWS.map((flow) => (
                <button
                  key={flow.id}
                  type="button"
                  aria-pressed={ember.persona.flow === flow.id}
                  onClick={() => ember.patchPersona({ flow: flow.id satisfies FlowId })}
                >
                  {flow.name}
                </button>
              ))}
            </div>
            <p className="lamp-caption">
              {lampById(ember.persona.lamp).name} · {flowById(ember.persona.flow).name}
            </p>
          </div>
        </div>
      </section>

      <section
        className="thread"
        ref={threadRef}
        onScroll={handleThreadScroll}
        aria-label="Conversation"
      >
        {!ember.hasKey ? (
          <form
            className="keycard"
            onSubmit={(event) => {
              event.preventDefault();
              ember.commitKey(keyDraft);
              setKeyDraft("");
            }}
          >
            <h2>Bring your Venice key</h2>
            <p className="hint">
              It stays in this browser. Requests send it through this app to Venice, and the app
              does not save the key on a server. Create one in your Venice account — Ember never
              calls the key-creation endpoint.
            </p>
            <div className="key-row">
              <input
                suppressHydrationWarning
                type="text"
                className="secret"
                autoComplete="off"
                spellCheck={false}
                aria-label="Venice API key"
                placeholder="Venice API key"
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
              <button className="primary" type="submit">
                Save
              </button>
            </div>
            <p className="hint">
              <a
                className="link"
                href="https://docs.venice.ai/getting-started/quick-start"
                target="_blank"
                rel="noopener noreferrer"
              >
                How keys work
              </a>
            </p>
          </form>
        ) : null}

        {ember.hydrated && ember.hasKey && ember.turns.length === 0 && !ember.partial ? (
          <div className="empty">
            <h2>Speak, and it answers.</h2>
            <p>
              Hold the mic or the space bar. {name} shows provider-exposed reasoning when available,
              talks back, and can search, read a page, or call an API you allow.
            </p>
            <div className="chips">
              {SUGGESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="chip"
                  onClick={() => void ember.send(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {ember.turns.map((turn, index) => (
          <Message
            key={`${turn.role}-${index}`}
            turn={turn}
            name={name}
            actions={
              turn.role === "tool" ? null : (
                <div className="msg-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(turn.content).catch(() => undefined)
                    }
                  >
                    Copy
                  </button>
                  {turn.role === "assistant" ? (
                    <button type="button" onClick={() => ember.replay(turn.content)}>
                      Speak
                    </button>
                  ) : null}
                  {turn.role === "user" && editAt === index ? (
                    <form
                      className="edit-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const text = editDraft.trim();
                        if (!text) return;
                        setEditAt(null);
                        ember.replaceFrom(index, text);
                      }}
                    >
                      <input
                        suppressHydrationWarning
                        value={editDraft}
                        aria-label="Edit message"
                        onChange={(event) => setEditDraft(event.target.value)}
                      />
                      <button type="submit">Send</button>
                    </form>
                  ) : null}
                  {turn.role === "user" && editAt !== index ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditAt(index);
                        setEditDraft(turn.content);
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  {index === lastUser ? (
                    <button type="button" onClick={ember.retry}>
                      Retry
                    </button>
                  ) : null}
                </div>
              )
            }
          />
        ))}
        {ember.partial ? (
          <article className="msg partial" aria-live="polite">
            <span className="msg-name">{name}</span>
            <p>{ember.partial}</p>
          </article>
        ) : null}
        {showNewResponse ? (
          <button
            type="button"
            className="new-response-pill"
            onClick={scrollToBottom}
            aria-label="Scroll to newest response"
            style={{
              position: "sticky",
              bottom: "1rem",
              alignSelf: "center",
              zIndex: 10,
              padding: "0.45rem 1rem",
              borderRadius: "9999px",
              background: "var(--color-wax, #d4653a)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            New response ↓
          </button>
        ) : null}
      </section>

      <footer className="dock">
        {ember.error
          ? (() => {
              const classified = classifyAppError(ember.error);
              return (
                <div
                  className="error-banner"
                  role="alert"
                  style={{
                    margin: "0.4rem 0",
                    padding: "0.5rem 0.8rem",
                    borderRadius: "0.5rem",
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <div>
                    <p className="error-line" style={{ margin: 0, fontWeight: 500 }}>
                      {classified.message}
                    </p>
                    <p
                      className="hint"
                      style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", opacity: 0.85 }}
                    >
                      {classified.actionHint}
                    </p>
                  </div>
                  {classified.kind === "auth" ? (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => ember.setSettingsOpen(true)}
                    >
                      Settings
                    </button>
                  ) : classified.kind === "catalog_stale" ? (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => ember.setSettingsOpen(true)}
                    >
                      Catalog
                    </button>
                  ) : null}
                </div>
              );
            })()
          : null}
        {ember.hydrated && ember.discovery?.notice ? (
          <p className="hint">{ember.discovery.notice}</p>
        ) : null}
        <div className="toggles">
          <button
            type="button"
            className="chip"
            aria-pressed={ember.handsFree}
            onClick={() => ember.setHandsFree((value) => !value)}
          >
            {ember.handsFree ? "Back and forth on" : "Back and forth"}
          </button>
          <button type="button" className="chip" onClick={ember.stopAll}>
            Stop
          </button>
          <button type="button" className="chip" onClick={ember.clearChat}>
            Clear
          </button>
        </div>
        <div className="composer">
          <textarea
            suppressHydrationWarning
            rows={1}
            placeholder={ember.recording ? "Listening…" : `Talk to ${name}`}
            aria-label="Message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendDraft();
              }
            }}
          />
          <button
            type="button"
            className="icon-btn mic"
            aria-pressed={ember.recording}
            aria-label={ember.recording ? "Stop and send voice" : "Start voice"}
            onClick={ember.toggleMic}
          >
            {ember.recording ? (
              <Square className="icon" aria-hidden="true" />
            ) : (
              <Mic className="icon" aria-hidden="true" />
            )}
          </button>
          <button type="button" className="icon-btn" aria-label="Send" onClick={sendDraft}>
            <Send className="icon" aria-hidden="true" />
          </button>
        </div>
        <p className="hint">Hold space to talk. Say “stop”, “clear conversation”, or “settings”.</p>
      </footer>

      <dialog
        ref={dialogRef}
        className="sheet"
        aria-labelledby="settings-title"
        onClose={() => ember.setSettingsOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          ember.setSettingsOpen(false);
        }}
      >
        <div className="sheet-head">
          <h2 id="settings-title">Settings</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close settings"
            onClick={() => ember.setSettingsOpen(false)}
          >
            <X className="icon" aria-hidden="true" />
          </button>
        </div>
        <div className="tabs" role="tablist" aria-label="Settings sections">
          {SETTINGS_TABS.map(([id, label], index) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sheet-body">
          {tab === "connection" ? (
            <section
              role="tabpanel"
              id="panel-connection"
              aria-labelledby="tab-connection"
              className="group"
            >
              <h3>Connection</h3>
              <p className="hint">
                {ember.tail ? `Key ending ${ember.tail}. ` : "No key saved. "}
                {ember.keyMode === "session"
                  ? "It stays for this tab only."
                  : "It stays in this browser."}{" "}
                Requests go through this app to Venice. The app does not save the key on a server.
              </p>
              <div className="seg" role="group" aria-label="Key storage">
                <button
                  type="button"
                  aria-pressed={ember.keyMode === "session"}
                  onClick={() => ember.setKeyMode("session")}
                >
                  This session
                </button>
                <button
                  type="button"
                  aria-pressed={ember.keyMode === "remember"}
                  onClick={() => ember.setKeyMode("remember")}
                >
                  Remember
                </button>
              </div>
              <form
                className="key-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!keyDraft.trim()) return;
                  ember.commitKey(keyDraft, ember.keyMode);
                  setKeyDraft("");
                }}
              >
                <input
                  suppressHydrationWarning
                  type="text"
                  className="secret"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Replace Venice API key"
                  placeholder="Replace key"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
                <button className="primary" type="submit">
                  Save
                </button>
              </form>
              <div className="confirm-actions">
                <button type="button" className="ghost" onClick={ember.refreshCatalog}>
                  Refresh catalog
                </button>
                {ember.hasKey ? (
                  <button type="button" className="ghost" onClick={ember.forgetKey}>
                    Remove key
                  </button>
                ) : null}
              </div>
              <p className="hint">
                {ember.discovery?.fetchedAt
                  ? `Catalog ${new Date(ember.discovery.fetchedAt).toLocaleString()}. `
                  : "Catalog not loaded yet. "}
                {ember.discovery?.notice ||
                  "Traits and models come from Venice, not a hardcoded list."}
                {funds ? ` Balance ${funds}.` : ""}
              </p>
            </section>
          ) : null}

          {tab === "model" ? (
            <section role="tabpanel" id="panel-model" aria-labelledby="tab-model" className="group">
              <h3>Generation controls</h3>
              <p className="hint">
                These change inference settings. They do not train or fine-tune the model.
              </p>
              <Field
                label="Text model"
                hint={
                  modelRow
                    ? [
                        modelRow.contextTokens ? `${modelRow.contextTokens} context` : "",
                        modelRow.privacy,
                        modelRow.price,
                        modelRow.supportsTools ? "tools" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || resolvedModel
                    : resolvedModel || "Refresh the catalog to bind this trait."
                }
              >
                <select
                  suppressHydrationWarning
                  value={ember.persona.textModel}
                  onChange={(event) => ember.patchPersona({ textModel: event.target.value })}
                >
                  <optgroup label="Traits">
                    {traitChoices(ember.discovery?.traits).map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </optgroup>
                  {textModels.length ? (
                    <optgroup label="Live models">
                      {textModels.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </Field>
              <div className="seg wrap" role="group" aria-label="Inference preset">
                {(Object.keys(PRESETS) as Exclude<PresetId, "custom">[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={ember.persona.preset === id}
                    onClick={() =>
                      ember.patchPersona({
                        preset: id,
                        temperature: PRESETS[id].temperature,
                        topP: PRESETS[id].topP,
                      })
                    }
                  >
                    {id}
                  </button>
                ))}
              </div>
              <Field label={`Temperature ${ember.persona.temperature.toFixed(2)}`}>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={ember.persona.temperature}
                  onChange={(event) =>
                    ember.patchPersona({
                      temperature: Number(event.target.value),
                      preset: "custom",
                    })
                  }
                />
              </Field>
              <Field label={`Top P ${ember.persona.topP.toFixed(2)}`}>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ember.persona.topP}
                  onChange={(event) =>
                    ember.patchPersona({ topP: Number(event.target.value), preset: "custom" })
                  }
                />
              </Field>
              <Field label="Max completion tokens" hint="0 lets the model decide.">
                <input
                  suppressHydrationWarning
                  type="number"
                  min={0}
                  max={8192}
                  step={16}
                  value={ember.persona.maxTokens}
                  onChange={(event) =>
                    ember.patchPersona({ maxTokens: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label={`Frequency penalty ${ember.persona.frequencyPenalty.toFixed(2)}`}>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={-2}
                  max={2}
                  step={0.1}
                  value={ember.persona.frequencyPenalty}
                  onChange={(event) =>
                    ember.patchPersona({ frequencyPenalty: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label={`Presence penalty ${ember.persona.presencePenalty.toFixed(2)}`}>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={-2}
                  max={2}
                  step={0.1}
                  value={ember.persona.presencePenalty}
                  onChange={(event) =>
                    ember.patchPersona({ presencePenalty: Number(event.target.value) })
                  }
                />
              </Field>
              <div className="field">
                <span className="field-label">Thinking</span>
                <div className="seg" role="group" aria-label="Thinking">
                  {(
                    [
                      ["live", "Live"],
                      ["stripped", "Quiet"],
                      ["off", "Off"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={ember.persona.thinking === value}
                      onClick={() => ember.patchPersona({ thinking: value satisfies ThinkingMode })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {tab === "persona" ? (
            <section
              role="tabpanel"
              id="panel-persona"
              aria-labelledby="tab-persona"
              className="group"
            >
              <h3>Persona</h3>
              <Field label="Spoken name">
                <input
                  suppressHydrationWarning
                  value={ember.persona.name}
                  maxLength={48}
                  onChange={(event) => ember.patchPersona({ name: event.target.value })}
                />
              </Field>
              <div className="seg wrap" role="group" aria-label="Prompt preset">
                {PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => ember.patchPersona({ systemPrompt: preset.text })}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => ember.patchPersona({ systemPrompt: DEFAULT_PROMPT })}
                >
                  Reset
                </button>
              </div>
              <Field
                label={`System prompt · ${ember.persona.systemPrompt.length}/8000 · ~${estimateTokens(ember.persona.systemPrompt)} tokens`}
              >
                <textarea
                  suppressHydrationWarning
                  value={ember.persona.systemPrompt}
                  maxLength={8000}
                  onChange={(event) => ember.patchPersona({ systemPrompt: event.target.value })}
                />
              </Field>
              <div className="field">
                <span className="field-label">Prompt with character</span>
                <div className="seg" role="group" aria-label="Prompt composition">
                  {(
                    [
                      ["blend", "Blend"],
                      ["persona", "Persona"],
                      ["character", "Character"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={ember.persona.promptMode === value}
                      onClick={() => ember.patchPersona({ promptMode: value satisfies PromptMode })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="field-hint">
                  Blend keeps your prompt and adds the character. Persona ignores the slug.
                  Character follows the Venice character.
                </span>
              </div>
              <Field label="Character slug">
                <div className="key-row">
                  <input
                    suppressHydrationWarning
                    value={charSlugDraft}
                    maxLength={80}
                    placeholder="optional"
                    onChange={(event) => setCharSlugDraft(event.target.value.trim())}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        ember.chooseCharacter(charSlugDraft);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="primary"
                    onClick={() => ember.chooseCharacter(charSlugDraft)}
                  >
                    Apply
                  </button>
                </div>
              </Field>
              <form
                className="key-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  setCharSearchError(null);
                  setCharSearched(true);
                  void ember
                    .findCharacters(charQuery)
                    .then((hits) => {
                      setCharHits(hits);
                      setCharSearchError(null);
                    })
                    .catch((err) => {
                      setCharHits([]);
                      setCharSearchError(
                        err instanceof Error
                          ? err.message
                          : "Could not load Venice characters — retry",
                      );
                    });
                }}
              >
                <input
                  suppressHydrationWarning
                  aria-label="Search Venice characters"
                  placeholder="Search characters"
                  value={charQuery}
                  onChange={(event) => setCharQuery(event.target.value)}
                />
                <button className="primary" type="submit">
                  Search
                </button>
              </form>
              {charSearchError ? (
                <div
                  style={{
                    margin: "0.4rem 0",
                    color: "#f87171",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <p className="hint" style={{ color: "inherit", margin: 0 }}>
                    {charSearchError}
                  </p>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setCharSearchError(null);
                      void ember
                        .findCharacters(charQuery)
                        .then(setCharHits)
                        .catch((err) => {
                          setCharHits([]);
                          setCharSearchError(
                            err instanceof Error
                              ? err.message
                              : "Could not load Venice characters — retry",
                          );
                        });
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : charSearched && charHits.length === 0 ? (
                <p className="hint" style={{ margin: "0.4rem 0" }}>
                  No matching characters found.
                </p>
              ) : null}
              <div className="char-list">
                {ember.recentCharacters.map((slug) => (
                  <button
                    key={`recent-${slug}`}
                    type="button"
                    className="chip"
                    onClick={() => ember.chooseCharacter(slug)}
                  >
                    Recent {slug}
                  </button>
                ))}
                {charHits.map((row) => (
                  <article key={row.slug} className="char-card">
                    <div>
                      <strong>{row.name}</strong>
                      <p className="hint">{row.description || row.slug}</p>
                    </div>
                    <div className="confirm-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => ember.chooseCharacter(row.slug)}
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => ember.toggleFav(row.slug)}
                      >
                        {ember.favs.includes(row.slug) ? "Unfavorite" : "Favorite"}
                      </button>
                    </div>
                  </article>
                ))}
                {ember.favs.map((slug) => (
                  <button
                    key={`fav-${slug}`}
                    type="button"
                    className="chip"
                    onClick={() => ember.chooseCharacter(slug)}
                  >
                    Favorite {slug}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {tab === "voice" ? (
            <section role="tabpanel" id="panel-voice" aria-labelledby="tab-voice" className="group">
              <h3>Voice</h3>
              <Field
                label="Speech model"
                hint={
                  compat.length
                    ? `Catalog maps this with ${compat.slice(0, 4).join(", ")}`
                    : "Voices come from the model catalog when Venice sends them."
                }
              >
                <select
                  suppressHydrationWarning
                  value={ember.persona.ttsModel}
                  onChange={(event) => {
                    const ttsModel = event.target.value;
                    ember.patchPersona({ ttsModel });
                    void ember.loadVoices(ttsModel);
                  }}
                >
                  {ttsModels.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Voice" hint="Type a cloned voice id if you have one.">
                <input
                  suppressHydrationWarning
                  list="ember-voices"
                  value={ember.persona.voice}
                  maxLength={64}
                  onChange={(event) => ember.patchPersona({ voice: event.target.value })}
                />
                <datalist id="ember-voices">
                  {voices.map((voice) => (
                    <option key={voice} value={voice} />
                  ))}
                </datalist>
              </Field>
              <Field label={`Speed ${ember.persona.speed.toFixed(2)}`}>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={ember.persona.speed}
                  onChange={(event) => ember.patchPersona({ speed: Number(event.target.value) })}
                />
              </Field>
              <Field label="Hearing model">
                <select
                  suppressHydrationWarning
                  value={ember.persona.sttModel}
                  onChange={(event) => ember.patchPersona({ sttModel: event.target.value })}
                >
                  {sttModels.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Microphone" hint="Available after the browser has mic permission.">
                <select
                  suppressHydrationWarning
                  defaultValue=""
                  onChange={(event) => ember.setInput(event.target.value)}
                >
                  <option value="">Default</option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </Field>
              <MicCalibration
                currentVad={ember.persona.vad}
                onApplyThreshold={(vad) => ember.patchPersona({ vad })}
              />
              <Field label={`Hands-free sensitivity ${ember.persona.vad.toFixed(3)}`}>
                <input
                  suppressHydrationWarning
                  type="range"
                  min={0.02}
                  max={0.2}
                  step={0.005}
                  value={ember.persona.vad}
                  onChange={(event) => ember.patchPersona({ vad: Number(event.target.value) })}
                />
              </Field>
              <Switch
                label="Speak replies"
                checked={ember.persona.speak}
                onChange={(speak) => ember.patchPersona({ speak })}
              />
              <h3>TTS studio</h3>
              <p className="hint">
                Speak text without sending it to chat. Uses the same voice, streamed when Venice
                allows it.
              </p>
              <Field label="Preview text">
                <textarea
                  suppressHydrationWarning
                  value={studioText}
                  maxLength={2000}
                  onChange={(event) => setStudioText(event.target.value)}
                />
              </Field>
              <div className="confirm-actions">
                <button type="button" className="primary" onClick={() => ember.replay(studioText)}>
                  Speak
                </button>
                <button type="button" className="ghost" onClick={ember.stopAll}>
                  Stop
                </button>
              </div>
            </section>
          ) : null}

          {tab === "tools" ? (
            <section role="tabpanel" id="panel-tools" aria-labelledby="tab-tools" className="group">
              <h3>Tools</h3>
              <div className="field">
                <span className="field-label">Web search</span>
                <div className="seg" role="group" aria-label="Web search">
                  {(
                    [
                      ["off", "Off"],
                      ["auto", "Auto"],
                      ["on", "On"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={ember.persona.webSearch === value}
                      onClick={() => ember.patchPersona({ webSearch: value satisfies SearchMode })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Switch
                label="Tools"
                hint="Search, read a page, or call an HTTP API. Model-driven HTTP runs only through integrations you define or session approvals. Writes always ask. Literal private and metadata addresses are blocked; a browser cannot verify where an arbitrary hostname resolves."
                checked={ember.persona.tools}
                onChange={(tools) => ember.patchPersona({ tools })}
              />
              {ember.integrations.length ? (
                <div className="char-list">
                  {ember.integrations.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className="chip"
                      title={`${it.methods.join(", ")} ${it.origin}${it.pathPrefix || "/"} — click to remove`}
                      onClick={() => ember.removeIntegration(it.id)}
                    >
                      {it.methods.join("·")} {it.origin}
                      {it.pathPrefix || ""}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint">
                  No integrations. Add one below, or approve a request as &quot;this session&quot;
                  when asked.
                </p>
              )}
              <IntegrationForm onAdd={(input) => ember.addIntegration(input)} />
            </section>
          ) : null}

          {tab === "appearance" ? (
            <section
              role="tabpanel"
              id="panel-appearance"
              aria-labelledby="tab-appearance"
              className="group"
            >
              <h3>Appearance</h3>
              <div className="field">
                <span className="field-label">Theme family</span>
                <div
                  className="char-list"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: "0.5rem",
                  }}
                >
                  {THEME_FAMILIES.map((fam) => {
                    const isSelected = appearance.theme === fam.id;
                    const preview = THEME_PREVIEWS[fam.id]?.dark;
                    return (
                      <button
                        key={fam.id}
                        type="button"
                        className="chip"
                        aria-pressed={isSelected}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.4rem 0.6rem",
                          border: isSelected ? "2px solid var(--focus-ring)" : undefined,
                        }}
                        onClick={() => patchAppearance({ theme: fam.id })}
                      >
                        <span
                          style={{
                            width: "1rem",
                            height: "1rem",
                            borderRadius: "50%",
                            background: preview?.accent ?? "#fff",
                            border: "1px solid rgba(255,255,255,0.2)",
                            display: "inline-block",
                            flexShrink: 0,
                          }}
                        />
                        <span>{fam.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="field">
                <span className="field-label">Mode</span>
                <div className="seg" role="group" aria-label="Color mode">
                  {(
                    [
                      ["system", "System"],
                      ["dark", "Dark"],
                      ["light", "Light"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={appearance.mode === value}
                      onClick={() => patchAppearance({ mode: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">Vessel form</span>
                <div className="seg wrap" role="group" aria-label="Orb shape">
                  {ORB_SHAPES.map((shapeItem) => (
                    <button
                      key={shapeItem.id}
                      type="button"
                      aria-pressed={appearance.orbShape === shapeItem.id}
                      onClick={() => patchAppearance({ orbShape: shapeItem.id })}
                    >
                      {shapeItem.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">Reduced motion</span>
                <div className="seg" role="group" aria-label="Reduced motion">
                  {(
                    [
                      ["system", "System"],
                      ["on", "Freeze"],
                      ["off", "Animate"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={appearance.reducedMotionOverride === value}
                      onClick={() => patchAppearance({ reducedMotionOverride: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="confirm-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => patchAppearance(DEFAULT_APPEARANCE)}
                >
                  Reset appearance
                </button>
              </div>
            </section>
          ) : null}

          {tab === "changer" ? (
            <div role="tabpanel" id="panel-changer" aria-labelledby="tab-changer">
              <VoiceChanger
                open
                epoch={ember.epoch}
                voices={voices}
                defaultVoice={ember.persona.voice}
                withKey={ember.withKey}
                onPlay={async (blob) => ember.playArrayBuffer(await blob.arrayBuffer())}
              />
            </div>
          ) : null}
        </div>
      </dialog>

      <AlertDialog.Root
        open={Boolean(ember.pending)}
        onOpenChange={(open) => {
          if (!open) ember.pending?.deny();
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 20,
              background: "rgba(0, 0, 0, 0.55)",
            }}
          />
          {ember.pending ? (
            <AlertDialog.Content className="confirm" style={{ zIndex: 30 }}>
              <AlertDialog.Title>
                {ember.pending.mutating ? "Allow this write?" : "Allow this request?"}
              </AlertDialog.Title>
              <AlertDialog.Description>
                {name} wants to send <strong>{ember.pending.method}</strong>{" "}
                <strong>
                  {ember.pending.origin}
                  {ember.pending.path}
                </strong>
                {ember.pending.bodyPreview ? (
                  <>
                    {" "}
                    with this data: <code>{ember.pending.bodyPreview}</code>
                  </>
                ) : null}
                . Static private and metadata addresses are blocked, but a browser cannot verify
                where an arbitrary hostname resolves. Durable access requires a scoped integration
                (origin + path prefix + method); writes are never remembered.
              </AlertDialog.Description>
              <div className="confirm-actions">
                {ember.pending.canIntegrate ? (
                  <AlertDialog.Action
                    type="button"
                    className="primary"
                    onClick={() => ember.pending?.allowIntegrate()}
                  >
                    Always (integration)
                  </AlertDialog.Action>
                ) : null}
                {ember.pending.canSession ? (
                  <AlertDialog.Action
                    type="button"
                    className="ghost"
                    onClick={() => ember.pending?.allowSession()}
                  >
                    This session
                  </AlertDialog.Action>
                ) : null}
                <AlertDialog.Action
                  type="button"
                  className={
                    !ember.pending.canIntegrate && !ember.pending.canSession ? "primary" : "ghost"
                  }
                  onClick={() => ember.pending?.allowOnce()}
                >
                  Once
                </AlertDialog.Action>
                <AlertDialog.Cancel type="button" className="ghost">
                  Deny
                </AlertDialog.Cancel>
              </div>
            </AlertDialog.Content>
          ) : null}
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function IntegrationForm({
  onAdd,
}: {
  onAdd: (input: { origin: string; pathPrefix: string; methods: string[] }) => {
    ok: boolean;
    error?: string;
  };
}) {
  const [origin, setOrigin] = useState("");
  const [prefix, setPrefix] = useState("");
  const [methods, setMethods] = useState("GET");
  const [error, setError] = useState("");
  const submit = () => {
    const result = onAdd({
      origin,
      pathPrefix: prefix,
      methods: methods
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
    });
    if (result.ok) {
      setOrigin("");
      setPrefix("");
      setMethods("GET");
      setError("");
    } else {
      setError(result.error ?? "Could not add the integration.");
    }
  };
  return (
    <div className="field">
      <span className="field-label">Add integration</span>
      <div className="key-row">
        <input
          aria-label="Integration origin"
          placeholder="https://api.example.com"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        />
        <input
          aria-label="Path prefix"
          placeholder="/v1"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
        />
        <input
          aria-label="Allowed methods"
          placeholder="GET, HEAD"
          value={methods}
          onChange={(e) => setMethods(e.target.value)}
        />
        <button type="button" className="primary" onClick={submit}>
          Add
        </button>
      </div>
      <span className="field-hint">
        Exact https origin, optional path prefix, and the methods the model may use there. Secrets
        in headers are never part of an integration; the model cannot see or set them here.
      </span>
      {error ? (
        <p role="alert" style={{ margin: "0.25rem 0 0", color: "var(--color-gold, inherit)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <span>
        <span className="field-label">{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
