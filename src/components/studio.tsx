import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, Mic, Send, Settings, Square, X } from "lucide-react";
import { ChatMenu } from "@/components/chat-menu";
import { Orb } from "@/components/orb";
import { RichText } from "@/components/rich-text";
import { VoiceChanger } from "@/components/voice-changer";
import { presentText } from "@/speech";
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
import { useEmber, voicesFor } from "@/use-ember";
import { resolveTextModel, traitChoices, type Balance } from "@/venice";

type SettingsTab = "connection" | "model" | "persona" | "voice" | "tools" | "changer";

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
  const threadRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const name = ember.persona.name.trim() || "Ember";
  const funds = money(ember.balance);

  useEffect(() => {
    visual.lamp = ember.persona.lamp;
    visual.flow = ember.persona.flow;
    document.documentElement.style.setProperty(
      "--lamp",
      LAMPS.find((lamp) => lamp.id === ember.persona.lamp)?.css ?? "#d4653a",
    );
  }, [ember.persona.lamp, ember.persona.flow]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ember.turns, ember.partial, ember.hydrated]);

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
  const openSettings = (next: SettingsTab) => {
    setTab(next);
    ember.setSettingsOpen(true);
    setMenuOpen(false);
  };
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
    />
  );
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
          <p className="brand-kicker">Private voice</p>
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
          <div className="orb-frame">
            <div className="orb-shadow" />
            <div className="orb-fallback" aria-hidden="true" />
            <Orb />
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

      <section className="thread" ref={threadRef} aria-label="Conversation">
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
                rel="noreferrer"
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
              Hold the mic or the space bar. {name} thinks in the open, talks back, and can search,
              read a page, or call an API you allow.
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
      </section>

      <footer className="dock">
        {ember.error ? <p className="error-line">{ember.error}</p> : null}
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
        <div className="tabs" role="tablist" aria-label="Settings">
          {(
            [
              ["connection", "Key"],
              ["model", "Model"],
              ["persona", "Persona"],
              ["voice", "Voice"],
              ["tools", "Tools"],
              ["changer", "Changer"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sheet-body">
          {tab === "connection" ? (
            <section className="group">
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
            <section className="group">
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
            <section className="group">
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
                <input
                  suppressHydrationWarning
                  value={ember.persona.characterSlug}
                  maxLength={80}
                  placeholder="optional"
                  onChange={(event) => ember.chooseCharacter(event.target.value.trim())}
                />
              </Field>
              <form
                className="key-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ember
                    .findCharacters(charQuery)
                    .then(setCharHits)
                    .catch(() => setCharHits([]));
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
            <section className="group">
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
            <section className="group">
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
                hint="Search, read a page, or call an HTTP API. Reads can be remembered per host. Writes always ask. Private networks stay blocked."
                checked={ember.persona.tools}
                onChange={(tools) => ember.patchPersona({ tools })}
              />
              {ember.hosts.length ? (
                <div className="char-list">
                  {ember.hosts.map((host) => (
                    <button
                      key={host}
                      type="button"
                      className="chip"
                      onClick={() => ember.forgetHost(host)}
                    >
                      Forget {host}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint">No hosts remembered.</p>
              )}
            </section>
          ) : null}

          {tab === "changer" ? (
            <VoiceChanger
              open
              epoch={ember.epoch}
              voices={voices}
              defaultVoice={ember.persona.voice}
              withKey={ember.withKey}
              onPlay={async (blob) => ember.playArrayBuffer(await blob.arrayBuffer())}
            />
          ) : null}
        </div>
      </dialog>

      {ember.pending ? (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-title">
          <h2 id="confirm-title">
            {ember.pending.mutating ? "Allow this request?" : "Allow this host?"}
          </h2>
          <p>
            {name} wants to {ember.pending.method} <strong>{ember.pending.host}</strong>
            {ember.pending.path}. Private and metadata addresses stay blocked.
            {ember.pending.mutating ? " This write is not remembered." : ""}
          </p>
          <div className="confirm-actions">
            {ember.pending.mutating ? null : (
              <button type="button" className="primary" onClick={() => ember.pending?.allow(true)}>
                Always
              </button>
            )}
            <button
              type="button"
              className={ember.pending.mutating ? "primary" : "ghost"}
              onClick={() => ember.pending?.allow(false)}
            >
              Once
            </button>
            <button type="button" className="ghost" onClick={() => ember.pending?.deny()}>
              Deny
            </button>
          </div>
        </div>
      ) : null}
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
