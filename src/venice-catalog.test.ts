import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_SCHEMA_VERSION,
  VeniceError,
  cacheModelVoices,
  chatBody,
  discoverModels,
  finishedTools,
  loadCatalog,
  mergeToolDeltas,
  modelVoices,
  modelVoicesResult,
  saveCatalog,
  shouldPersistAssistantTurn,
  streamChat,
  synthesize,
  synthesizeStream,
  toolRoundProtocolError,
  transcribe,
  type Discovery,
} from "./venice.ts";
import {
  compatMapFromArrays,
  moneyRateLabel,
  normalizeCapabilities,
  normalizeFinishReason,
  parseCompatibilityMap,
  priceLabelFromRates,
  resolveReasoningEffort,
} from "./catalog-normalize.ts";
import type { ModelCapabilities } from "./catalog-types.ts";
import { DEFAULT_PERSONA, type Persona, type ToolCall } from "./state.ts";

/* ----------------------------- mocks ---------------------------------- */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    dump: () => map,
  };
}

const g = globalThis as { localStorage?: unknown };
const realLocalStorage = g.localStorage;
g.localStorage = memoryStorage();

test.after(() => {
  g.localStorage = realLocalStorage;
});

function jsonResponse(data: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.etag) headers.set("etag", init.etag);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(router: (url: string) => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(router(String(input)))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/* ---------------------------- fixtures --------------------------------- */

// Synthetic, redacted fixtures — ids are invented for tests, not copied from
// a live key. Live verification of the exact shapes remains a to-do (VEN-001).
const TEXT_ROW = {
  id: "text-model-1",
  model_spec: {
    name: "Text Model",
    traits: ["default"],
    availableContextTokens: 131072,
    capabilities: {
      function_calling: true,
      reasoning: true,
      vision: true,
      streaming: true,
      temperature: true,
      top_p: true,
      frequency_penalty: true,
      presence_penalty: true,
      reasoning_efforts: ["low", "medium", "high"],
    },
    constraints: { maxOutputTokens: 8192 },
    privacy: { type: "confidential" },
    pricing: { input: 4e-7, output: 1.5e-6 },
  },
};

const TTS_ROW = {
  id: "tts-model-1",
  model_spec: { name: "TTS", voices: ["af_bella", "af_sky"], pricing: { input: 0 } },
};

function capsFixture(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    tools: null,
    reasoning: null,
    vision: null,
    webSearch: null,
    streaming: null,
    temperature: null,
    topP: null,
    frequencyPenalty: null,
    presencePenalty: null,
    maxContextTokens: null,
    maxOutputTokens: null,
    reasoningEffortValues: null,
    privacyTier: "",
    inputPrice: null,
    outputPrice: null,
    ...overrides,
  };
}

function discoveryFixture(overrides: Partial<Discovery> = {}): Discovery {
  return {
    text: [],
    tts: [],
    asr: [],
    traits: {},
    voices: {},
    characters: [],
    compat: {},
    compatMap: {},
    fetchedAt: 1000,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    etag: null,
    stale: false,
    notice: "",
    ...overrides,
  };
}

function personaFixture(overrides: Partial<Persona> = {}): Persona {
  return {
    ...DEFAULT_PERSONA,
    textModel: "text-model-1",
    temperature: 0.9,
    topP: 0.8,
    frequencyPenalty: 0.5,
    presencePenalty: 0.4,
    maxTokens: 8192,
    ...overrides,
  };
}

function catalogRoutes(overrides: Record<string, unknown> = {}): (url: string) => Response {
  const compat = overrides.compat ?? {
    data: {
      object: "list",
      type: "compatibility_mapping",
      "provider-alias-tts": "tts-model-1",
      "provider-alias-text": "text-model-1",
    },
  };
  return (url: string) => {
    if (url.includes("/models?type=text"))
      return jsonResponse({ data: [TEXT_ROW] }, { etag: '"rev-7"' });
    if (url.includes("/models?type=tts")) return jsonResponse({ data: [TTS_ROW] });
    if (url.includes("/models?type=asr")) return jsonResponse({ data: [] });
    if (url.includes("/models/traits")) return jsonResponse({ data: { default: "text-model-1" } });
    if (url.includes("/characters")) return jsonResponse({ data: [] });
    if (url.includes("/models/compatibility_mapping"))
      return jsonResponse(typeof compat === "string" ? JSON.parse(compat) : compat);
    return errorResponse(404, "not found");
  };
}

/* --------------------------- VEN-001 ----------------------------------- */

test("VEN-001: compatibility mapping parses the documented alias → canonical shape", () => {
  const parsed = parseCompatibilityMap({
    data: {
      object: "list",
      type: "compatibility_mapping",
      "provider-alias-tts": "tts-model-1",
      "provider-alias-text": "text-model-1",
    },
  });
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.legacy, false);
  assert.deepEqual(parsed.map, {
    "provider-alias-tts": "tts-model-1",
    "provider-alias-text": "text-model-1",
  });
});

test("VEN-001: legacy string-list shape keeps a guarded fallback", () => {
  const parsed = parseCompatibilityMap({
    data: { "legacy-alias": ["canonical-1", "canonical-2"] },
  });
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.legacy, true);
  // Defensible interpretation of the legacy list: the first entry is the
  // canonical mapping the provider name resolves to.
  assert.equal(parsed.map["legacy-alias"], "canonical-1");
});

test("VEN-001: schema drift is detected instead of silently yielding {}", () => {
  const parsed = parseCompatibilityMap({ data: { object: "list", mappings: [{ id: 1 }] } });
  assert.equal(parsed.recognized, false);
  assert.deepEqual(parsed.map, {});
  const empty = parseCompatibilityMap({ data: {} });
  assert.equal(empty.recognized, true);
});

test("VEN-001: drift guard keeps the previous cached mapping and sets a notice", async () => {
  const restore = installFetch(
    catalogRoutes({ compat: { data: { object: "list", entries: [1] } } }),
  );
  try {
    const previous = discoveryFixture({ compatMap: { "old-alias": "old-canonical" } });
    const found = await discoverModels("key", undefined, previous);
    assert.deepEqual(found.compatMap, { "old-alias": "old-canonical" });
    assert.match(found.notice, /unrecognized/i);
    assert.match(found.notice, /last saved mapping/i);
  } finally {
    restore();
  }
});

test("VEN-001: discovery folds the mapping into compatMap and the display compat", async () => {
  const restore = installFetch(catalogRoutes());
  try {
    const found = await discoverModels("key");
    assert.equal(found.compatMap["provider-alias-tts"], "tts-model-1");
    assert.deepEqual(found.compat["provider-alias-tts"], ["tts-model-1"]);
    assert.equal(found.notice, "");
  } finally {
    restore();
  }
});

test("VEN-002: discovery stamps schemaVersion and the provider etag", async () => {
  const restore = installFetch(catalogRoutes());
  try {
    const found = await discoverModels("key");
    assert.equal(found.schemaVersion, CATALOG_SCHEMA_VERSION);
    assert.equal(found.etag, '"rev-7"');
    assert.equal(found.stale, false);
  } finally {
    restore();
  }
});

/* --------------------------- VEN-003 ----------------------------------- */

test("VEN-003: capability adapter normalizes the fields the API reports", () => {
  const caps = normalizeCapabilities(TEXT_ROW.model_spec, TEXT_ROW);
  assert.equal(caps.tools, true);
  assert.equal(caps.reasoning, true);
  assert.equal(caps.vision, true);
  assert.equal(caps.streaming, true);
  assert.equal(caps.temperature, true);
  assert.equal(caps.topP, true);
  assert.equal(caps.frequencyPenalty, true);
  assert.equal(caps.presencePenalty, true);
  assert.equal(caps.maxContextTokens, 131072);
  assert.equal(caps.maxOutputTokens, 8192);
  assert.deepEqual(caps.reasoningEffortValues, ["low", "medium", "high"]);
  assert.equal(caps.privacyTier, "confidential");
  assert.deepEqual(caps.inputPrice, { amount: 4e-7, unit: "" });
  assert.equal(caps.tools, true);
});

test("VEN-003: unreported capabilities stay null, never false", () => {
  const caps = normalizeCapabilities(null, { id: "bare" });
  assert.equal(caps.tools, null);
  assert.equal(caps.temperature, null);
  assert.equal(caps.maxContextTokens, null);
  assert.equal(caps.maxOutputTokens, null);
  assert.equal(caps.reasoningEffortValues, null);
});

test("VEN-003: capability flags gate generation parameters in chatBody", () => {
  const persona = personaFixture();
  const turns = [{ role: "user" as const, content: "hello" }];
  const legacy = chatBody(persona, turns, {}, true);
  assert.equal(legacy.temperature, 0.9);
  assert.equal(legacy.top_p, 0.8);
  assert.equal(legacy.frequency_penalty, 0.5);
  assert.equal(legacy.presence_penalty, 0.4);
  assert.equal(legacy.max_completion_tokens, 8192);

  const gated = chatBody(persona, turns, {}, true, {
    capabilities: capsFixture({
      temperature: false,
      topP: false,
      frequencyPenalty: false,
      presencePenalty: false,
      maxOutputTokens: 4096,
    }),
  });
  assert.equal("temperature" in gated, false);
  assert.equal("top_p" in gated, false);
  assert.equal("frequency_penalty" in gated, false);
  assert.equal("presence_penalty" in gated, false);
  // Resetting to a smaller model clamps the preserved max output instead of
  // sending an invalid provider setting.
  assert.equal(gated.max_completion_tokens, 4096);
  assert.ok(Array.isArray(gated.tools));

  const unknown = chatBody(persona, turns, {}, false, { capabilities: capsFixture() });
  assert.equal(unknown.temperature, 0.9);
  assert.equal(unknown.max_completion_tokens, 8192);
});

test("VEN-005: reasoning_effort is only sent when advertised, and only advertised values", () => {
  const persona = personaFixture();
  const turns = [{ role: "user" as const, content: "think" }];
  const caps = capsFixture({ reasoning: true, reasoningEffortValues: ["low", "medium", "high"] });

  assert.equal(resolveReasoningEffort(caps, "low"), "low");
  assert.equal(resolveReasoningEffort(caps, "extreme"), null);
  assert.equal(resolveReasoningEffort(caps, null), null);
  assert.equal(resolveReasoningEffort(capsFixture({ reasoningEffortValues: null }), "low"), null);

  const accepted = chatBody(persona, turns, {}, false, {
    capabilities: caps,
    reasoningEffort: "low",
  });
  assert.equal(accepted.reasoning_effort, "low");
  const rejected = chatBody(persona, turns, {}, false, {
    capabilities: caps,
    reasoningEffort: "extreme",
  });
  assert.equal("reasoning_effort" in rejected, false);
  const unsupported = chatBody(persona, turns, {}, false, {
    capabilities: capsFixture(),
    reasoningEffort: "low",
  });
  assert.equal("reasoning_effort" in unsupported, false);
  const noOptions = chatBody(persona, turns, {}, false);
  assert.equal("reasoning_effort" in noOptions, false);
});

/* --------------------------- VEN-007 ----------------------------------- */

test("VEN-007: pricing labels always carry units, or hide", () => {
  assert.equal(moneyRateLabel({ amount: 4e-7, unit: "" }, "input"), "$0.4 / 1M input tokens");
  assert.equal(moneyRateLabel({ amount: 1.5e-6, unit: "" }, "output"), "$1.5 / 1M output tokens");
  assert.equal(
    moneyRateLabel({ amount: 2.5, unit: "1M input tokens" }, "input"),
    "$2.5 / 1M input tokens",
  );
  assert.equal(moneyRateLabel({ amount: 0, unit: "" }, "input"), "$0");
  // Unit metadata absent and the value is not recognizably per-token → hide.
  assert.equal(moneyRateLabel({ amount: 3, unit: "" }, "input"), null);
  assert.equal(moneyRateLabel(null, "output"), null);

  const label = priceLabelFromRates({ amount: 4e-7, unit: "" }, { amount: 1.5e-6, unit: "" });
  assert.match(label, /\$0\.4 \/ 1M input tokens/);
  assert.match(label, /\$1\.5 \/ 1M output tokens/);
  assert.equal(priceLabelFromRates(null, null), "");
});

test("VEN-007: discovery rows show unit pricing, never bare numbers", async () => {
  const restore = installFetch(catalogRoutes());
  try {
    const found = await discoverModels("key");
    const row = found.text.find((m) => m.id === "text-model-1");
    assert.ok(row);
    assert.match(row.price, /\$0\.4 \/ 1M input tokens/);
    assert.doesNotMatch(row.price, /^in /);
  } finally {
    restore();
  }
});

/* --------------------- VEN-008 / VEN-009 -------------------------------- */

test("VEN-008: voice fetch failure is a visible state, not a silent empty list", async () => {
  const restore = installFetch(() => errorResponse(500, "provider exploded"));
  try {
    const result = await modelVoicesResult("key", "tts-model-1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "http");
      assert.equal(result.retryable, true);
      assert.match(result.message, /provider exploded/);
    }
    // Backward-compat wrapper still resolves to [] for existing call sites…
    assert.deepEqual(await modelVoices("key", "tts-model-1"), []);
  } finally {
    restore();
  }
});

test("VEN-008: auth failures stay non-retryable and keep throwing in the wrapper", async () => {
  const restore = installFetch(() => errorResponse(401, "Venice rejected this key."));
  try {
    const result = await modelVoicesResult("key", "tts-model-1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "auth");
      assert.equal(result.retryable, false);
      assert.equal(result.status, 401);
    }
    await assert.rejects(
      () => modelVoices("key", "tts-model-1"),
      (err: unknown) => err instanceof VeniceError && err.status === 401,
    );
  } finally {
    restore();
  }
});

test("VEN-009: a successful voice fetch is durably folded into the catalog cache", async () => {
  const storage = g.localStorage as ReturnType<typeof memoryStorage>;
  storage.clear();
  const restore = installFetch((url: string) => {
    if (url.includes("/models/tts-model-1"))
      return jsonResponse({ model_spec: { voices: ["af_bella", "af_sky"] } });
    return errorResponse(404, "not found");
  });
  try {
    const result = await modelVoicesResult("key", "tts-model-1");
    assert.deepEqual(result, { ok: true, voices: ["af_bella", "af_sky"] });
    const cached = loadCatalog();
    assert.ok(cached);
    assert.deepEqual(cached.voices["tts-model-1"], ["af_bella", "af_sky"]);
    assert.equal(cached.schemaVersion, CATALOG_SCHEMA_VERSION);

    // Explicit fold-in path also merges into an existing catalog.
    const base = discoveryFixture({ voices: { "other-model": ["v1"] } });
    const merged = cacheModelVoices(base, "tts-model-1", ["af_bella"]);
    assert.ok(merged);
    assert.deepEqual(merged.voices["other-model"], ["v1"]);
    assert.deepEqual(merged.voices["tts-model-1"], ["af_bella"]);
    assert.deepEqual(loadCatalog()?.voices["tts-model-1"], ["af_bella"]);
  } finally {
    restore();
  }
});

test("VEN-002: a v1 cache migrates to a canonical compatMap and is flagged offline", () => {
  const storage = g.localStorage as ReturnType<typeof memoryStorage>;
  storage.clear();
  storage.setItem(
    "ember.catalog.v1",
    JSON.stringify({
      text: [],
      tts: [],
      asr: [],
      traits: {},
      voices: {},
      characters: [],
      compat: { "old-alias": ["old-canonical", "old-alias-2"] },
      fetchedAt: 500,
    }),
  );
  const cached = loadCatalog();
  assert.ok(cached);
  assert.equal(cached.schemaVersion, 1);
  assert.equal(cached.stale, true);
  assert.equal(cached.compatMap["old-alias"], "old-canonical");
  assert.deepEqual(cached.compat["old-alias"], ["old-canonical", "old-alias-2"]);
  assert.match(cached.notice, /offline/i);
});

/* --------------------------- VEN-010 ----------------------------------- */

function seedDeltas(entries: Array<[number, Partial<ToolCall>]>): Map<number, ToolCall> {
  const acc = new Map<number, ToolCall>();
  for (const [index, call] of entries) {
    mergeToolDeltas(acc, {
      type: "tool_delta",
      index,
      id: call.id ?? "",
      name: call.name ?? "",
      arguments: call.arguments ?? "",
    });
  }
  return acc;
}

test("VEN-010: incomplete provider tool calls are dropped, never assigned synthetic ids", () => {
  const acc = seedDeltas([
    [0, { id: "call_valid123", name: "venice_web_search", arguments: '{"q":1}' }],
    [1, { id: "", name: "venice_scrape", arguments: "{}" }],
    [2, { id: "call_valid456", name: "", arguments: "{}" }],
  ]);
  const calls = finishedTools(acc);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.id, "call_valid123");
  assert.ok(calls.every((call) => !call.id.startsWith("call_") || call.id === "call_valid123"));
  const message = toolRoundProtocolError(acc);
  assert.match(message ?? "", /without a valid call id/i);
  assert.equal(toolRoundProtocolError(new Map()), null);
});

test("VEN-010: synthesize/transcribe refuse to invent a model id", async () => {
  const restore = installFetch(() => {
    throw new Error("fetch must not be called without a model id");
  });
  try {
    const persona = { ttsModel: "   ", voice: "eve", speed: 1 };
    const signal = new AbortController().signal;
    await assert.rejects(
      () => synthesize("key", "hello", persona, signal),
      (err: unknown) => err instanceof VeniceError && err.status === 400,
    );
    await assert.rejects(
      () => synthesizeStream("key", "hello", persona, signal),
      (err: unknown) => err instanceof VeniceError && err.status === 400,
    );
    await assert.rejects(
      () => transcribe("key", new Blob(["pcm"]), "  ", signal),
      (err: unknown) => err instanceof VeniceError && err.status === 400,
    );
  } finally {
    restore();
  }
});

/* --------------------------- VEN-011 ----------------------------------- */

test("VEN-011: finish_reason is normalized from the stream", async () => {
  const frames = [
    'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"content-filter"}]}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const restore = installFetch(
    () => new Response(frames, { headers: { "content-type": "text/event-stream" } }),
  );
  try {
    const events: Array<{ type: string; reason?: string | null; text?: string }> = [];
    for await (const ev of streamChat("key", {}, new AbortController().signal)) {
      events.push(
        ev.type === "finish"
          ? { type: ev.type, reason: ev.reason }
          : ev.type === "content"
            ? { type: ev.type, text: ev.text }
            : { type: ev.type },
      );
    }
    assert.deepEqual(events, [
      { type: "content", text: "Hello" },
      { type: "finish", reason: "content_filter" },
    ]);
  } finally {
    restore();
  }
});

test("VEN-011: finish_reason aliases and unknown values", () => {
  assert.equal(normalizeFinishReason("stop"), "stop");
  assert.equal(normalizeFinishReason("max_tokens"), "length");
  assert.equal(normalizeFinishReason("tool_call"), "tool_calls");
  assert.equal(normalizeFinishReason("content-filter"), "content_filter");
  assert.equal(normalizeFinishReason("some_future_reason"), "some_future_reason");
  assert.equal(normalizeFinishReason(null), null);
  assert.equal(normalizeFinishReason(12), null);
});

test("VEN-011: an empty completion produces no persisted assistant turn", () => {
  assert.equal(shouldPersistAssistantTurn({ content: "   " }), false);
  assert.equal(shouldPersistAssistantTurn({ content: "", toolCalls: [] }), false);
  assert.equal(shouldPersistAssistantTurn({ content: "hi" }), true);
  assert.equal(shouldPersistAssistantTurn({ content: "", thinking: "hmm" }), true);
  assert.equal(
    shouldPersistAssistantTurn({
      content: "",
      toolCalls: [{ id: "call_1", name: "venice_web_search", arguments: "{}" }],
    }),
    true,
  );
});

test("VEN-001: compatMapFromArrays migrates legacy display arrays", () => {
  assert.deepEqual(compatMapFromArrays({ a: ["x", "y"], b: [], c: ["z"] }), { a: "x", c: "z" });
  assert.deepEqual(compatMapFromArrays(null), {});
  assert.deepEqual(compatMapFromArrays(undefined), {});
});

test("catalog save/load round-trips with schema metadata", () => {
  const storage = g.localStorage as ReturnType<typeof memoryStorage>;
  storage.clear();
  const found = discoveryFixture({ voices: { "tts-model-1": ["af_bella"] } });
  saveCatalog(found);
  const cached = loadCatalog();
  assert.ok(cached);
  assert.equal(cached.schemaVersion, CATALOG_SCHEMA_VERSION);
  assert.deepEqual(cached.voices["tts-model-1"], ["af_bella"]);
  assert.equal(cached.stale, true);
});
