import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PERSONA,
  DEFAULT_PROVIDER_RESERVE_TOKENS,
  LAST_KNOWN_STT_MODELS,
  LAST_KNOWN_TTS_MODELS,
  MIN_HISTORY_BUDGET_TOKENS,
  TTS_FALLBACK,
  VOICE_FALLBACK,
  VOICE_FALLBACK_STALE,
  contextWindow,
  historyBudget,
  isLastKnownModelId,
  loadKey,
  loadKeyMode,
  loadMessages,
  loadPersona,
  savePersona,
  validateToolCall,
  validateTurn,
  validateTurns,
  type Persona,
} from "./state.ts";

/* ----------------------------- mocks ---------------------------------- */

function memoryStorage() {
  const map = new Map<string, string>();
  let failing: Error | null = null;
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: string) => {
      if (failing) throw failing;
      map.set(key, String(value));
    },
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    failSetWith: (err: Error | null) => {
      failing = err;
    },
  };
}

const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
const realLocalStorage = g.localStorage;
const realSessionStorage = g.sessionStorage;

g.localStorage = memoryStorage();
g.sessionStorage = memoryStorage();

test.after(() => {
  g.localStorage = realLocalStorage;
  g.sessionStorage = realSessionStorage;
});

const PERSONA_KEY = "ember.persona.v1";
const KEY_MODE_KEY = "ember.keyMode.v1";
const API_KEY = "ember.apiKey";
const MESSAGES_KEY = "ember.messages.v1";

function localStore() {
  return g.localStorage as ReturnType<typeof memoryStorage>;
}

function sessionStore() {
  return g.sessionStorage as ReturnType<typeof memoryStorage>;
}

function seedPersona(value: unknown): void {
  localStore().setItem(PERSONA_KEY, JSON.stringify(value));
}

/* --------------------------- STATE-001 --------------------------------- */

test("STATE-001: fresh storage defaults to the session-only key mode", () => {
  localStore().clear();
  sessionStore().clear();
  assert.equal(loadKeyMode(), "session");
  assert.equal(loadKey(), "");
});

test("STATE-001: an explicit remember choice is preserved (migration)", () => {
  localStore().clear();
  localStore().setItem(KEY_MODE_KEY, "remember");
  localStore().setItem(API_KEY, "venice-key-1234");
  assert.equal(loadKeyMode(), "remember");
  assert.equal(loadKey(), "venice-key-1234");

  localStore().setItem(KEY_MODE_KEY, "session");
  sessionStore().setItem(API_KEY, "session-key-99");
  assert.equal(loadKeyMode(), "session");
  assert.equal(loadKey(), "session-key-99");
});

/* ---------------------- STATE-003 / STATE-004 --------------------------- */

test("STATE-003: a missing temperature migrates to the 0.7 default, not 0", () => {
  localStore().clear();
  seedPersona({ name: "Legacy" });
  const persona = loadPersona();
  assert.equal(persona.temperature, 0.7);
  assert.equal(persona.name, "Legacy");

  seedPersona({ temperature: 1.5 });
  assert.equal(loadPersona().temperature, 1.5);
  seedPersona({ temperature: 99 });
  assert.equal(loadPersona().temperature, 2);
});

test("STATE-004: a missing speed migrates to the 1 default, not 0.25", () => {
  localStore().clear();
  seedPersona({ name: "Legacy" });
  const persona = loadPersona();
  assert.equal(persona.speed, 1);

  seedPersona({ speed: 2 });
  assert.equal(loadPersona().speed, 2);
});

/* --------------------------- STATE-005 --------------------------------- */

test("STATE-005: a missing preset migrates to balanced, junk stays custom", () => {
  localStore().clear();
  seedPersona({});
  assert.equal(loadPersona().preset, "balanced");

  seedPersona({ preset: "creative" });
  assert.equal(loadPersona().preset, "creative");

  seedPersona({ preset: "nonsense" });
  assert.equal(loadPersona().preset, "custom");
});

/* --------------------------- STATE-002 --------------------------------- */

test("STATE-002: savePersona returns ok and round-trips through loadPersona", () => {
  localStore().clear();
  const persona: Persona = { ...DEFAULT_PERSONA, name: "Ember Two", temperature: 1.1 };
  const result = savePersona(persona);
  assert.deepEqual(result, { ok: true });
  assert.equal(loadPersona().name, "Ember Two");
  assert.equal(loadPersona().temperature, 1.1);
});

test("STATE-002: quota and security failures return a structured result, never throw", () => {
  localStore().clear();
  localStore().failSetWith(new DOMException("quota", "QuotaExceededError"));
  assert.deepEqual(savePersona(DEFAULT_PERSONA), { ok: false, reason: "quota" });

  localStore().failSetWith(new DOMException("denied", "SecurityError"));
  assert.deepEqual(savePersona(DEFAULT_PERSONA), { ok: false, reason: "unavailable" });

  localStore().failSetWith(new Error("boom"));
  assert.deepEqual(savePersona(DEFAULT_PERSONA), { ok: false, reason: "unavailable" });
});

test("STATE-002: invalid input returns { ok: false, reason: 'invalid' } without throwing", () => {
  const save = savePersona as (p: unknown) => { ok: boolean; reason?: string };
  assert.deepEqual(save(null), { ok: false, reason: "invalid" });
  assert.deepEqual(save("nope"), { ok: false, reason: "invalid" });
});

/* --------------------------- STATE-006 --------------------------------- */

test("STATE-006: tool turns require tool_call_id and name", () => {
  assert.deepEqual(
    validateTurn({
      role: "tool",
      content: "result",
      tool_call_id: "call_1",
      name: "venice_web_search",
    }),
    {
      role: "tool",
      content: "result",
      tool_call_id: "call_1",
      name: "venice_web_search",
    },
  );
  assert.equal(validateTurn({ role: "tool", content: "result", name: "venice_web_search" }), null);
  assert.equal(validateTurn({ role: "tool", content: "result", tool_call_id: "call_1" }), null);
  assert.equal(
    validateTurn({ role: "tool", content: "result", tool_call_id: "  ", name: "x" }),
    null,
  );
  assert.equal(
    validateTurn({ role: "tool", content: "result", tool_call_id: "call_1", name: 42 }),
    null,
  );
});

test("STATE-006: assistant tool_calls are validated when present", () => {
  const good = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", name: "venice_web_search", arguments: "{}" }],
  };
  const parsed = validateTurn(good);
  assert.ok(parsed);
  assert.equal(parsed.role, "assistant");
  if (parsed.role === "assistant") {
    assert.deepEqual(parsed.tool_calls, [
      { id: "call_1", name: "venice_web_search", arguments: "{}" },
    ]);
  }

  assert.equal(
    validateTurn({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "", name: "x", arguments: "{}" }],
    }),
    null,
  );
  assert.equal(validateTurn({ role: "assistant", content: "", tool_calls: "nope" }), null);
  assert.equal(
    validateTurn({ role: "assistant", content: "", citations: [{ title: 1, url: "u" }] }),
    null,
  );
  assert.deepEqual(
    validateTurn({
      role: "assistant",
      content: "",
      citations: [{ title: "t", url: "https://x.test" }],
      thinking: "hmm",
    }),
    {
      role: "assistant",
      content: "",
      citations: [{ title: "t", url: "https://x.test" }],
      thinking: "hmm",
    },
  );
  assert.deepEqual(validateTurn({ role: "user", content: "hi" }), { role: "user", content: "hi" });
  assert.equal(validateTurn({ role: "system", content: "hi" }), null);
  assert.equal(validateTurn("nope"), null);
});

test("STATE-006: validateToolCall and validateTurns are the canonical schema", () => {
  assert.deepEqual(validateToolCall({ id: "call_1", name: "n", arguments: "{}" }), {
    id: "call_1",
    name: "n",
    arguments: "{}",
  });
  assert.equal(validateToolCall({ id: "call_1", name: "n" }), null);

  const mixed = [
    { role: "user", content: "hi" },
    { role: "tool", content: "broken" },
    null,
    { role: "assistant", content: "", tool_calls: [{ id: "call_9", name: "n", arguments: "{}" }] },
  ];
  assert.equal(validateTurns(mixed).length, 2);
  assert.deepEqual(validateTurns("nope"), []);
});

test("STATE-006: loadMessages drops invalid turns from persisted session history", () => {
  sessionStore().clear();
  sessionStore().setItem(
    MESSAGES_KEY,
    JSON.stringify([
      { role: "user", content: "hi" },
      { role: "tool", content: "missing id and name" },
      { role: "tool", content: "ok", tool_call_id: "call_1", name: "venice_web_search" },
      { role: "assistant", content: "", tool_calls: [{ bad: true }] },
      { role: "assistant", content: "answer" },
    ]),
  );
  const turns = loadMessages();
  assert.equal(turns.length, 3);
  assert.deepEqual(
    turns.map((turn) => turn.role),
    ["user", "tool", "assistant"],
  );
});

/* --------------------------- VEN-006 ----------------------------------- */

test("VEN-006: history budget derives from the model context and floors sanely", () => {
  assert.equal(historyBudget({}), null);
  assert.equal(historyBudget({ modelContextTokens: 0 }), null);
  assert.equal(historyBudget({ modelContextTokens: Number.NaN }), null);

  const budget = historyBudget({
    modelContextTokens: 128000,
    systemPrompt: "x".repeat(4000),
    toolSchema: { type: "object" },
    requestedMaxOutput: 4096,
    providerReserve: 0,
  });
  // 128000 − 1000 (system) − 5 (schema: Math.ceil(17/4)) − 4096 − 0 reserve.
  assert.equal(budget, 122899);

  assert.equal(historyBudget({ modelContextTokens: 128000, providerReserve: 0 }), 128000);
  assert.equal(historyBudget({ modelContextTokens: 100 }), MIN_HISTORY_BUDGET_TOKENS);
  assert.equal(
    historyBudget({ modelContextTokens: 8192, providerReserve: DEFAULT_PROVIDER_RESERVE_TOKENS }),
    8192 - 512,
  );
});

test("VEN-006: contextWindow scales with model context and keeps the legacy numeric path", () => {
  const turns = Array.from({ length: 10 }, (_, index) => ({
    role: "user" as const,
    content: "x".repeat(4000) + index,
  }));
  const legacy = contextWindow(turns, 6000);
  const scaled = contextWindow(turns, {
    modelContextTokens: 131072,
    requestedMaxOutput: 4096,
  });
  assert.equal(legacy.length, 5);
  assert.equal(scaled.length, 10);
  assert.ok(scaled.length > legacy.length);
  assert.equal(scaled.at(-1)?.content, turns.at(-1)?.content);

  // Unknown model context falls back to the legacy 6000 budget.
  assert.deepEqual(contextWindow(turns, {}), contextWindow(turns, 6000));
});

/* --------------------------- VEN-002 ----------------------------------- */

test("VEN-002: last-known fallbacks are explicit stale cache entries", () => {
  assert.ok(LAST_KNOWN_TTS_MODELS.length > 0);
  assert.ok(LAST_KNOWN_STT_MODELS.length > 0);
  for (const entry of [...LAST_KNOWN_TTS_MODELS, ...LAST_KNOWN_STT_MODELS]) {
    assert.equal(entry.stale, true);
  }
  assert.equal(TTS_FALLBACK, LAST_KNOWN_TTS_MODELS);
  assert.equal(isLastKnownModelId(LAST_KNOWN_TTS_MODELS[0].id), true);
  assert.equal(isLastKnownModelId("some-live-model"), false);
  assert.equal(VOICE_FALLBACK_STALE, true);
  assert.ok(VOICE_FALLBACK["tts-xai-v1"].length > 0);
  assert.equal(DEFAULT_PERSONA.ttsModel, LAST_KNOWN_TTS_MODELS[0].id);
  assert.equal(DEFAULT_PERSONA.sttModel, LAST_KNOWN_STT_MODELS[0].id);
});
