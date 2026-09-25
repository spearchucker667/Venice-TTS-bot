import type { Persona, ToolCall, Turn } from "./state.ts";
import { TRAITS, resolveTextModel, systemContent } from "./state.ts";
import type { CompatibilityMap, ModelCapabilities } from "./catalog-types.ts";
import {
  compatArraysFromMap,
  compatMapFromArrays,
  inputRate,
  normalizeCapabilities,
  normalizeFinishReason,
  outputRate,
  parseCompatibilityMap,
  priceLabelFromRates,
  resolveReasoningEffort,
} from "./catalog-normalize.ts";
import { createSseParser } from "./chat/sse.ts";
import { inspectUrl, packUntrusted } from "./tools/policy.ts";
import {
  decideHttpPermission,
  listSessionGrants,
  type HttpIntegration,
} from "./tools/integrations.ts";
import { contentLengthOverLimit, readBoundedBody } from "./tools/response-budget.ts";

/** Inference only. Never call POST /api_keys — that route is admin-only. */

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/api/venice${p}`;
}

export class VeniceError extends Error {
  readonly status: number;
  readonly usd: string | null;
  readonly diem: string | null;

  constructor(status: number, message: string, headers?: Headers) {
    super(message);
    this.name = "VeniceError";
    this.status = status;
    this.usd = headers?.get("x-venice-balance-usd") ?? null;
    this.diem = headers?.get("x-venice-balance-diem") ?? null;
  }
}

export type Balance = { usd: string | null; diem: string | null };

export function balanceFrom(headers: Headers): Balance {
  return {
    usd: headers.get("x-venice-balance-usd"),
    diem: headers.get("x-venice-balance-diem"),
  };
}

function defaultStatusMessage(status: number): string {
  if (status === 401) return "Venice rejected this key.";
  if (status === 402) return "Venice balance is empty. Top up to continue.";
  if (status === 429) return "Venice is rate-limiting this key. Wait a moment.";
  return `Venice request failed (${status}).`;
}

async function errorText(res: Response, key: string): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return defaultStatusMessage(res.status);
  }
  let message = "";
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === "string") message = json.error;
    else if (json.error && typeof json.error.message === "string") message = json.error.message;
    else if (typeof json.message === "string") message = json.message;
  } catch {
    message = text;
  }
  message = message.replace(/\s+/g, " ").trim();
  if (key && message.includes(key)) message = message.split(key).join("…");
  if (!message) return defaultStatusMessage(res.status);
  return message.slice(0, 280);
}

async function veniceFetch(key: string, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${key}`);
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) {
    const message = await errorText(res, key);
    throw new VeniceError(res.status, message, res.headers);
  }
  return res;
}

export type ModelRow = {
  id: string;
  name: string;
  traits: string[];
  supportsTools: boolean | null;
  contextTokens: number | null;
  privacy: string;
  price: string;
  /** VEN-003: full normalized capability descriptor; null when not reported. */
  capabilities: ModelCapabilities | null;
};

export type VeniceCharacter = {
  slug: string;
  name: string;
  description: string;
};

export type Discovery = {
  text: ModelRow[];
  tts: ModelRow[];
  asr: ModelRow[];
  traits: Record<string, string>;
  voices: Record<string, string[]>;
  characters: VeniceCharacter[];
  /** Display form of the compatibility mapping (alias → compatible ids). */
  compat: Record<string, string[]>;
  /** VEN-001: canonical alias/provider name → canonical model ID mapping. */
  compatMap: CompatibilityMap;
  fetchedAt: number;
  /** VEN-002: cache schema version (CATALOG_SCHEMA_VERSION). */
  schemaVersion: number;
  /** VEN-002: provider revision marker when the response exposed one. */
  etag: string | null;
  /** True for restored caches — live discovery has not confirmed this data. */
  stale: boolean;
  notice: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function supportsTools(spec: Record<string, unknown> | null): boolean | null {
  const caps = asRecord(spec?.capabilities);
  if (!caps) return null;
  const keys = Object.keys(caps).filter((k) => /tool|function/i.test(k));
  if (keys.length === 0) return null;
  return keys.some((k) => Boolean(caps[k]));
}

function privacyLabel(spec: Record<string, unknown> | null, row: Record<string, unknown>): string {
  const raw = spec?.privacy ?? row.privacy;
  if (typeof raw === "string") return raw.slice(0, 40);
  const bag = asRecord(raw);
  const bit = bag?.type ?? bag?.tier ?? bag?.level;
  return typeof bit === "string" ? bit.slice(0, 40) : "";
}

function priceLabel(spec: Record<string, unknown> | null): string {
  const pricing = asRecord(spec?.pricing);
  if (!pricing) return "";
  // VEN-007: units always come along — "$X / 1M input tokens", or the unit the
  // catalog metadata specifies; unlabeled non-per-token rates are hidden.
  return priceLabelFromRates(inputRate(pricing), outputRate(pricing));
}

function contextTokens(
  spec: Record<string, unknown> | null,
  row: Record<string, unknown>,
): number | null {
  const raw = spec?.availableContextTokens ?? row.availableContextTokens ?? spec?.context_length;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function parseModels(json: unknown): ModelRow[] {
  const root = asRecord(json);
  const data = root?.data;
  if (!Array.isArray(data)) return [];
  const rows: ModelRow[] = [];
  for (const item of data) {
    const row = asRecord(item);
    if (!row || typeof row.id !== "string") continue;
    const spec = asRecord(row.model_spec);
    const name = typeof spec?.name === "string" ? spec.name : row.id;
    const traits = Array.isArray(spec?.traits)
      ? spec.traits.filter((t): t is string => typeof t === "string")
      : [];
    rows.push({
      id: row.id,
      name,
      traits,
      supportsTools: supportsTools(spec),
      contextTokens: contextTokens(spec, row),
      privacy: privacyLabel(spec, row),
      price: priceLabel(spec),
      capabilities: normalizeCapabilities(spec, row),
    });
  }
  return rows;
}

function parseTraits(json: unknown): Record<string, string> {
  const root = asRecord(json);
  const data = asRecord(root?.data) ?? root;
  if (!data) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && k !== "object" && k !== "type") out[k] = v;
  }
  return out;
}

function voicesFromSpec(spec: Record<string, unknown> | null): string[] {
  if (!spec) return [];
  const bags = [spec.voices, spec.availableVoices, asRecord(spec.constraints)?.voices];
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    const ids = bag
      .map((v) => {
        if (typeof v === "string") return v;
        const o = asRecord(v);
        if (!o) return "";
        if (typeof o.id === "string") return o.id;
        if (typeof o.name === "string") return o.name;
        return "";
      })
      .filter((id) => id && !/^(alloy|echo|fable|onyx|nova|shimmer)$/i.test(id));
    if (ids.length) return ids;
  }
  return [];
}

function normalizeRow(row: ModelRow): ModelRow {
  return {
    id: row.id,
    name: row.name || row.id,
    traits: row.traits ?? [],
    supportsTools: row.supportsTools ?? null,
    contextTokens: row.contextTokens ?? null,
    privacy: row.privacy ?? "",
    price: row.price ?? "",
    capabilities: row.capabilities ?? null,
  };
}

function parseCharacters(json: unknown): VeniceCharacter[] {
  const data = asRecord(json)?.data;
  if (!Array.isArray(data)) return [];
  const rows: VeniceCharacter[] = [];
  for (const item of data) {
    const row = asRecord(item);
    if (!row || typeof row.slug !== "string" || typeof row.name !== "string") continue;
    rows.push({
      slug: row.slug.slice(0, 80),
      name: row.name.slice(0, 80),
      description: typeof row.description === "string" ? row.description.slice(0, 180) : "",
    });
  }
  return rows;
}

export const CATALOG_SCHEMA_VERSION = 2;
const CATALOG_KEY = "ember.catalog.v1";

export function loadCatalog(): Discovery | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Discovery;
    if (!parsed || !Array.isArray(parsed.text)) return null;
    // VEN-002: v1 caches predate compatMap/schemaVersion — derive the
    // canonical map from the legacy display arrays (first entry wins).
    const compatMap: CompatibilityMap =
      parsed.compatMap && typeof parsed.compatMap === "object"
        ? parsed.compatMap
        : compatMapFromArrays(parsed.compat);
    return {
      text: (parsed.text ?? []).map(normalizeRow),
      tts: (parsed.tts ?? []).map(normalizeRow),
      asr: (parsed.asr ?? []).map(normalizeRow),
      traits: parsed.traits ?? {},
      voices: parsed.voices ?? {},
      characters: parsed.characters ?? [],
      compat: parsed.compat ?? compatArraysFromMap(compatMap),
      compatMap,
      fetchedAt: parsed.fetchedAt ?? 0,
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
      etag: typeof parsed.etag === "string" ? parsed.etag : null,
      stale: true,
      notice:
        "Showing the last catalog saved in this browser. Catalog is offline until the next refresh.",
    };
  } catch {
    return null;
  }
}

export function saveCatalog(found: Discovery): void {
  try {
    localStorage.setItem(
      CATALOG_KEY,
      JSON.stringify({ ...found, schemaVersion: CATALOG_SCHEMA_VERSION, voices: found.voices }),
    );
  } catch {
    /* quota */
  }
}

type JsonEnvelope = { json: unknown; etag: string | null };

async function readJson(key: string, path: string, signal?: AbortSignal): Promise<JsonEnvelope> {
  const res = await veniceFetch(key, path, { signal });
  return { json: await res.json(), etag: res.headers.get("etag") };
}

export async function discoverModels(
  key: string,
  signal?: AbortSignal,
  previous?: Discovery | null,
): Promise<Discovery> {
  const jobs = await Promise.allSettled([
    readJson(key, "/models?type=text", signal),
    readJson(key, "/models?type=tts", signal),
    readJson(key, "/models?type=asr", signal),
    readJson(key, "/models/traits", signal),
    readJson(key, "/characters?limit=40&isAdult=false", signal),
    readJson(key, "/models/compatibility_mapping", signal),
  ]);
  for (const job of jobs) {
    if (
      job.status === "rejected" &&
      job.reason instanceof VeniceError &&
      (job.reason.status === 401 || job.reason.status === 402)
    ) {
      throw job.reason;
    }
  }
  const at = (index: number) => {
    const job = jobs[index];
    return job?.status === "fulfilled" ? job.value : null;
  };
  const jsonAt = (index: number) => at(index)?.json ?? null;
  const etagAt = (index: number) => at(index)?.etag ?? null;
  const text = parseModels(jsonAt(0));
  const tts = parseModels(jsonAt(1));
  const asr = parseModels(jsonAt(2));
  const traits = parseTraits(jsonAt(3));
  const characters = parseCharacters(jsonAt(4));

  // VEN-001: the mapping endpoint returns alias → canonical model ID. On
  // schema drift keep the previously cached mapping instead of silently
  // adopting an empty one.
  const compatParse = parseCompatibilityMap(jsonAt(5));
  const notices: string[] = [];
  let compatMap: CompatibilityMap;
  let compat: Record<string, string[]>;
  if (compatParse.recognized) {
    compatMap = compatParse.map;
    compat = compatArraysFromMap(compatMap);
  } else {
    compatMap = previous?.compatMap ?? {};
    compat = previous?.compat ?? compatArraysFromMap(compatMap);
    notices.push("Compatibility data format unrecognized; keeping the last saved mapping.");
  }

  const voices: Record<string, string[]> = {};
  const ttsJson = asRecord(jsonAt(1));
  const ttsData = Array.isArray(ttsJson?.data) ? ttsJson.data : [];
  for (const item of ttsData) {
    const row = asRecord(item);
    if (!row || typeof row.id !== "string") continue;
    voices[row.id] = voicesFromSpec(asRecord(row.model_spec));
  }
  const failed = jobs.some((job) => job.status === "rejected");
  if (!text.length) {
    notices.push("Text models did not load. Chat traits need a successful catalog refresh.");
  } else if (failed) {
    notices.push("Part of the catalog failed. The rest is live.");
  }
  return {
    text,
    tts,
    asr,
    traits,
    voices,
    characters,
    compat,
    compatMap,
    fetchedAt: Date.now(),
    schemaVersion: CATALOG_SCHEMA_VERSION,
    etag: etagAt(0) ?? etagAt(1) ?? etagAt(2),
    stale: false,
    notice: notices.join(" "),
  };
}

export async function searchCharacters(
  key: string,
  query: string,
  signal?: AbortSignal,
): Promise<VeniceCharacter[]> {
  const q = query.trim().slice(0, 80);
  const path = q
    ? `/characters?limit=30&isAdult=false&search=${encodeURIComponent(q)}`
    : "/characters?limit=30&isAdult=false";
  return parseCharacters((await readJson(key, path, signal)).json);
}

/**
 * VEN-008: discriminated result for per-model voice discovery. Non-auth
 * failures stay visible — "voice catalog unavailable" with retry — instead of
 * silently degrading to an empty list.
 */
export type VoicesFetchResult =
  | { ok: true; voices: string[] }
  | {
      ok: false;
      reason: "auth" | "http" | "network";
      message: string;
      status: number | null;
      retryable: boolean;
    };

export async function modelVoicesResult(
  key: string,
  id: string,
  signal?: AbortSignal,
): Promise<VoicesFetchResult> {
  let res: Response;
  try {
    res = await veniceFetch(key, `/models/${encodeURIComponent(id)}`, { signal });
  } catch (err) {
    if (err instanceof VeniceError) {
      const auth = err.status === 401 || err.status === 402;
      return {
        ok: false,
        reason: auth ? "auth" : "http",
        message: err.message,
        status: err.status,
        retryable: !auth,
      };
    }
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return {
      ok: false,
      reason: "network",
      message: err instanceof Error ? err.message : "Voice catalog unavailable.",
      status: null,
      retryable: true,
    };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      reason: "network",
      message: "Voice catalog response was not readable.",
      status: res.status,
      retryable: true,
    };
  }
  const root = asRecord(json);
  const spec = asRecord(root?.model_spec) ?? asRecord(asRecord(root?.data)?.model_spec);
  const voices = voicesFromSpec(spec);
  persistModelVoices(id, voices);
  return { ok: true, voices };
}

/**
 * Backward-compatible wrapper for existing call sites: auth/balance failures
 * still throw; other failures still resolve to []. Prefer modelVoicesResult so
 * the failure can surface as "voice catalog unavailable" with a retry.
 */
export async function modelVoices(
  key: string,
  id: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await modelVoicesResult(key, id, signal);
  if (result.ok) return result.voices;
  if (result.reason === "auth") throw new VeniceError(result.status ?? 401, result.message);
  return [];
}

/**
 * VEN-009: durably fold a model-specific voice list into the cached catalog so
 * a reload does not lose it. Returns the updated catalog (or the input when
 * nothing could be cached).
 */
export function cacheModelVoices(
  catalog: Discovery | null,
  model: string,
  voices: string[],
): Discovery | null {
  const id = model.trim();
  if (!id || !voices.length) return catalog;
  const base: Discovery = catalog ?? {
    text: [],
    tts: [],
    asr: [],
    traits: {},
    voices: {},
    characters: [],
    compat: {},
    compatMap: {},
    fetchedAt: Date.now(),
    schemaVersion: CATALOG_SCHEMA_VERSION,
    etag: null,
    stale: false,
    notice: "",
  };
  const next: Discovery = { ...base, voices: { ...base.voices, [id]: voices } };
  saveCatalog(next);
  return next;
}

function persistModelVoices(model: string, voices: string[]): void {
  try {
    cacheModelVoices(loadCatalog(), model, voices);
  } catch {
    /* storage unavailable — the in-memory catalog still has the voices */
  }
}

export { resolveTextModel } from "./state.ts";

export function modelSupportsTools(selection: string, discovery: Discovery | null): boolean {
  const id = resolveTextModel(selection, discovery?.traits ?? {});
  const row = discovery?.text.find((m) => m.id === id);
  if (!row || row.supportsTools === null) return selection === "trait:function_calling_default";
  return row.supportsTools;
}

type ApiMessage = {
  role: string;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

function toApiMessage(turn: Turn): ApiMessage {
  if (turn.role === "tool") {
    return {
      role: "tool",
      content: turn.content,
      tool_call_id: turn.tool_call_id,
      name: turn.name,
    };
  }
  if (turn.role === "assistant" && turn.tool_calls?.length) {
    return {
      role: "assistant",
      content: turn.content,
      tool_calls: turn.tool_calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: turn.role, content: turn.content };
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "venice_web_search",
      description:
        "Search the public web through Venice. Use for fresh facts, news, or anything past your knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "venice_scrape",
      description: "Fetch a public http(s) page as markdown through Venice.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "http_request",
      description:
        "Call an external HTTP API from the user's browser. The user must confirm every request. Private and metadata addresses are blocked.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string" },
        },
        required: ["method", "url"],
      },
    },
  },
];

export type ChatRequestOptions = {
  /**
   * VEN-003/004: normalized capabilities of the selected model. When omitted
   * (or null) chatBody keeps its legacy behavior and sends every set
   * parameter; when provided, parameters the model explicitly does not
   * support (`false`) are omitted, and `maxOutputTokens` (when a number)
   * additionally clamps the requested max output.
   */
  capabilities?: ModelCapabilities | null;
  /** VEN-005: requested reasoning effort; sent only when the model advertises it. */
  reasoningEffort?: string | null;
};

export function chatBody(
  persona: Persona,
  turns: Turn[],
  traits: Record<string, string>,
  withTools: boolean,
  options?: ChatRequestOptions,
) {
  const venice_parameters: Record<string, unknown> = {
    include_venice_system_prompt: false,
    enable_web_search: persona.webSearch,
  };
  if (persona.promptMode !== "persona" && persona.characterSlug)
    venice_parameters.character_slug = persona.characterSlug;
  if (persona.webSearch !== "off") venice_parameters.enable_web_citations = true;
  if (persona.thinking === "off") venice_parameters.disable_thinking = true;
  if (persona.thinking === "stripped") venice_parameters.strip_thinking_response = true;

  const model = resolveTextModel(persona.textModel, traits);
  const caps = options?.capabilities ?? null;
  // `null` capability means "not reported" — keep sending (legacy behavior);
  // an explicit `false` means the model does not support the parameter.
  const sends = (flag: boolean | null): boolean => flag !== false;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemContent(persona) }, ...turns.map(toApiMessage)],
    stream: true,
    venice_parameters,
  };
  if (sends(caps ? caps.temperature : null)) body.temperature = persona.temperature;
  if (sends(caps ? caps.topP : null)) body.top_p = persona.topP;
  if (persona.frequencyPenalty && sends(caps ? caps.frequencyPenalty : null))
    body.frequency_penalty = persona.frequencyPenalty;
  if (persona.presencePenalty && sends(caps ? caps.presencePenalty : null))
    body.presence_penalty = persona.presencePenalty;
  if (persona.maxTokens >= 16) {
    const cap = caps?.maxOutputTokens;
    // Resetting to a smaller model must not preserve an oversized request.
    body.max_completion_tokens =
      typeof cap === "number" && cap > 0 ? Math.min(persona.maxTokens, cap) : persona.maxTokens;
  }
  const effort = resolveReasoningEffort(caps, options?.reasoningEffort);
  if (effort) body.reasoning_effort = effort;
  if (withTools) body.tools = TOOLS;
  return body;
}

export type StreamEvent =
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_delta"; index: number; id: string; name: string; arguments: string }
  | { type: "finish"; reason: string | null }
  | { type: "citation"; title: string; url: string }
  | { type: "protocol"; message: string };

type DeltaTool = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

function pushCitation(into: StreamEvent[], title: string, url: string, seen: Set<string>) {
  if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
  seen.add(url);
  into.push({ type: "citation", title: title || url, url });
}

function eventsFromData(data: string, seen: Set<string>): StreamEvent[] {
  if (!data || data === "[DONE]") return [];
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return [{ type: "protocol", message: "Skipped a malformed stream event." }];
  }
  const root = asRecord(json);
  if (!root) return [];
  const out: StreamEvent[] = [];
  harvest(root, out, seen, 0);
  const choices = root.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const row = asRecord(choice);
      if (!row) continue;
      for (const ev of eventsFromChoice(row, seen)) out.push(ev);
    }
  }
  return out;
}

function harvest(node: unknown, into: StreamEvent[], seen: Set<string>, depth: number) {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, into, seen, depth + 1);
    return;
  }
  const o = asRecord(node);
  if (!o) return;
  const url = o.url ?? o.uri ?? o.link;
  if (typeof url === "string" && (typeof o.title === "string" || typeof o.name === "string")) {
    pushCitation(into, String(o.title ?? o.name ?? ""), url, seen);
  }
  for (const key of ["citations", "search_results", "web_search_results", "results", "documents"]) {
    if (key in o) harvest(o[key], into, seen, depth + 1);
  }
}

function eventsFromChoice(choice: Record<string, unknown>, seen: Set<string>): StreamEvent[] {
  const out: StreamEvent[] = [];
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  const content = delta?.content ?? message?.content;
  if (typeof content === "string" && content) out.push({ type: "content", text: content });
  const reasoning = delta?.reasoning_content ?? message?.reasoning_content ?? delta?.reasoning;
  if (typeof reasoning === "string" && reasoning) out.push({ type: "reasoning", text: reasoning });
  const tools = (delta?.tool_calls ?? message?.tool_calls) as unknown;
  if (Array.isArray(tools)) {
    tools.forEach((raw, i) => {
      const call = raw as DeltaTool;
      const fn = call.function ?? {};
      out.push({
        type: "tool_delta",
        index: typeof call.index === "number" ? call.index : i,
        id: call.id ?? "",
        name: fn.name ?? "",
        arguments: fn.arguments ?? "",
      });
    });
  }
  if ("finish_reason" in choice && choice.finish_reason != null) {
    // VEN-011: normalize into the canonical set (stop/length/content_filter/
    // tool_calls/error); unknown provider reasons pass through unchanged.
    const reason = normalizeFinishReason(choice.finish_reason);
    if (reason) {
      out.push({ type: "finish", reason });
    }
  }
  harvest(choice, out, seen, 0);
  return out;
}

export async function* streamChat(
  key: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onResponse?: (res: Response) => void,
): AsyncGenerator<StreamEvent> {
  const res = await veniceFetch(key, "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  onResponse?.(res);
  const ct = res.headers.get("content-type") ?? "";
  const seen = new Set<string>();
  if (!ct.includes("text/event-stream") && ct.includes("application/json")) {
    const json = asRecord(await res.json());
    const choices = json?.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        const row = asRecord(choice);
        if (row) {
          for (const ev of eventsFromChoice(row, seen)) yield ev;
        }
      }
    }
    const extra: StreamEvent[] = [];
    harvest(json, extra, seen, 0);
    for (const ev of extra) yield ev;
    return;
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const pending: StreamEvent[] = [];
  const parser = createSseParser((frame) => {
    for (const ev of eventsFromData(frame.data, seen)) pending.push(ev);
  });
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
    while (pending.length) {
      const ev = pending.shift();
      if (ev) yield ev;
    }
  }
  parser.push(decoder.decode());
  parser.finish();
  while (pending.length) {
    const ev = pending.shift();
    if (ev) yield ev;
  }
}

export async function transcribe(
  key: string,
  blob: Blob,
  model: string,
  signal: AbortSignal,
  onResponse?: (res: Response) => void,
): Promise<string> {
  const type = blob.type || "audio/webm";
  const ext =
    type.includes("mp4") || type.includes("m4a") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const file = new File([blob], `speech.${ext}`, { type: type || "audio/webm" });
  const form = new FormData();
  // VEN-002: never silently fall back to a hardcoded operational model id.
  const sttModel = model.trim();
  if (!sttModel) {
    throw new VeniceError(
      400,
      "No speech-to-text model selected. Choose one in Settings, then retry.",
    );
  }
  form.append("file", file);
  form.append("model", sttModel);
  form.append("response_format", "json");
  const res = await veniceFetch(key, "/audio/transcriptions", {
    method: "POST",
    body: form,
    signal,
  });
  onResponse?.(res);
  const json = (await res.json()) as { text?: string } | string;
  if (typeof json === "string") return json.trim();
  return typeof json.text === "string" ? json.text.trim() : "";
}

export async function synthesize(
  key: string,
  text: string,
  persona: Pick<Persona, "ttsModel" | "voice" | "speed">,
  signal: AbortSignal,
  onResponse?: (res: Response) => void,
): Promise<ArrayBuffer> {
  const input = text.trim().slice(0, 4096);
  // VEN-002: the model must come from the persona/catalog — never substitute
  // a hardcoded operational id when it is missing.
  const ttsModel = persona.ttsModel.trim();
  if (!ttsModel) {
    throw new VeniceError(400, "No TTS model selected. Choose one in Settings, then retry.");
  }
  const res = await veniceFetch(key, "/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ttsModel,
      input,
      voice: persona.voice || "eve",
      response_format: "mp3",
      speed: persona.speed || 1,
    }),
    signal,
  });
  onResponse?.(res);
  return res.arrayBuffer();
}

export async function synthesizeStream(
  key: string,
  text: string,
  persona: Pick<Persona, "ttsModel" | "voice" | "speed">,
  signal: AbortSignal,
  onResponse?: (res: Response) => void,
): Promise<Response> {
  const input = text.trim().slice(0, 1200);
  // VEN-002: the model must come from the persona/catalog — never substitute
  // a hardcoded operational id when it is missing.
  const ttsModel = persona.ttsModel.trim();
  if (!ttsModel) {
    throw new VeniceError(400, "No TTS model selected. Choose one in Settings, then retry.");
  }
  const res = await veniceFetch(key, "/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ttsModel,
      input,
      voice: persona.voice || "eve",
      response_format: "pcm",
      speed: persona.speed || 1,
      streaming: true,
    }),
    signal,
  });
  onResponse?.(res);
  return res;
}

export type VoiceQuote = { quote: string; durationSeconds: number };
export type VoiceJob = { queueId: string; status: string; durationSeconds: number };

export async function quoteVoiceChange(
  key: string,
  model: string,
  durationSeconds: number,
  signal: AbortSignal,
): Promise<VoiceQuote> {
  const json = asRecord(
    await postJson(
      key,
      "/audio/voice-changer/quote",
      { model, duration_seconds: durationSeconds },
      signal,
    ),
  );
  return {
    quote: typeof json?.quote === "string" ? json.quote : "",
    durationSeconds: Number(json?.duration_seconds ?? durationSeconds) || durationSeconds,
  };
}

export async function queueVoiceChange(
  key: string,
  input: { model: string; file: File; voice: string; removeNoise: boolean; seed: string },
  signal: AbortSignal,
): Promise<VoiceJob> {
  const form = new FormData();
  form.append("model", input.model);
  form.append("file", input.file);
  form.append("voice", input.voice);
  if (input.removeNoise) form.append("remove_background_noise", "true");
  if (input.seed.trim()) form.append("seed", input.seed.trim().slice(0, 40));
  const res = await veniceFetch(key, "/audio/voice-changer/queue", {
    method: "POST",
    body: form,
    signal,
  });
  const json = asRecord(await res.json());
  const queueId = typeof json?.queue_id === "string" ? json.queue_id : "";
  if (!queueId) throw new VeniceError(502, "Venice did not return a voice-changer queue id.");
  return {
    queueId,
    status: typeof json?.status === "string" ? json.status : "QUEUED",
    durationSeconds: Number(json?.duration_seconds ?? 0) || 0,
  };
}

export async function retrieveVoiceChange(
  key: string,
  model: string,
  queueId: string,
  signal: AbortSignal,
): Promise<{ status: string; audio: Blob | null }> {
  const res = await veniceFetch(key, "/audio/voice-changer/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, queue_id: queueId }),
    signal,
  });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    const json = asRecord(await res.json());
    return { status: typeof json?.status === "string" ? json.status : "PROCESSING", audio: null };
  }
  return { status: "DONE", audio: await res.blob() };
}

export async function completeVoiceChange(
  key: string,
  model: string,
  queueId: string,
  signal: AbortSignal,
): Promise<void> {
  await postJson(
    key,
    "/audio/voice-changer/complete",
    { model, queue_id: queueId, delete_media_on_completion: true },
    signal,
  );
}

export type HttpConfirm = {
  host: string;
  /** Exact origin ("https://host") the permission scope is derived from. */
  origin: string;
  method: string;
  /** Pathname + search, for display. */
  path: string;
  /** URL pathname only, for prefix matching. */
  pathname: string;
  mutating: boolean;
  /** Short preview of the data being sent (empty for bodyless requests). */
  bodyPreview: string;
  /** Full request-body size in bytes after the tool's own cap. */
  bodyBytes: number;
};

export type ToolContext = {
  key: string;
  signal: AbortSignal;
  confirmHttp: (req: HttpConfirm) => Promise<boolean>;
  /** User-defined external integrations; arbitrary model HTTP is off without a match. */
  httpIntegrations?: readonly HttpIntegration[];
};

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const json = JSON.parse(raw) as unknown;
    const o = asRecord(json);
    return o ?? {};
  } catch {
    return {};
  }
}

export function mergeToolDeltas(
  acc: Map<number, ToolCall>,
  ev: Extract<StreamEvent, { type: "tool_delta" }>,
): void {
  const prev = acc.get(ev.index) ?? { id: "", name: "", arguments: "" };
  acc.set(ev.index, {
    id: ev.id || prev.id,
    name: ev.name || prev.name,
    arguments: prev.arguments + (ev.arguments || ""),
  });
}

/** Provider tool-call ids are opaque tokens (OpenAI-style "call_…"); never fabricate one. */
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;

/**
 * VEN-010: detect unrecoverable provider tool-call protocol errors. Returns a
 * user-facing message when an accumulated call lacks a valid provider id or a
 * function name. Such calls must NOT be repaired with synthetic ids — the
 * provider would not recognize them — so the tool round terminates with this
 * error while user-visible text is preserved and regenerate stays possible.
 */
export function toolRoundProtocolError(acc: Map<number, ToolCall>): string | null {
  const entries = [...acc.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, call] of entries) {
    if (!call.name.trim()) return "The provider sent a tool call without a function name.";
    if (!TOOL_CALL_ID_PATTERN.test(call.id.trim()))
      return `The provider sent tool call "${call.name}" without a valid call id.`;
  }
  return null;
}

/**
 * VEN-010: only provider-complete calls (valid id + name) are returned.
 * Incomplete calls are dropped — never assigned synthetic ids — and can be
 * diagnosed via toolRoundProtocolError.
 */
export function finishedTools(acc: Map<number, ToolCall>): ToolCall[] {
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => ({
      id: call.id.trim(),
      name: call.name,
      arguments: call.arguments || "{}",
    }))
    .filter((call) => call.name.trim() && TOOL_CALL_ID_PATTERN.test(call.id));
}

/**
 * VEN-011: an empty completion (no content, no thinking, no tool calls) must
 * not produce an invisible persisted assistant turn. The turn flow should
 * check this before appending the assistant turn.
 */
export function shouldPersistAssistantTurn(candidate: {
  content: string;
  thinking?: string;
  toolCalls?: unknown[];
}): boolean {
  if (candidate.toolCalls?.length) return true;
  if (candidate.content.trim()) return true;
  return Boolean(candidate.thinking?.trim());
}

async function postJson(
  key: string,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await veniceFetch(key, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return res.json();
}

const READ_METHODS = new Set(["GET", "HEAD"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HEADER_BAN = new Set([
  "host",
  "origin",
  "referer",
  "content-length",
  "connection",
  "cookie",
  "transfer-encoding",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
]);

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const args = parseArgs(call.arguments);
  try {
    if (call.name === "venice_web_search") {
      const query = String(args.query ?? "")
        .trim()
        .slice(0, 400);
      if (!query) return "Tool error: missing query.";
      const json = asRecord(
        await postJson(ctx.key, "/augment/search", { query, limit: 5 }, ctx.signal),
      );
      const results = Array.isArray(json?.results) ? json.results.slice(0, 5) : [];
      const slim = results.map((item) => {
        const o = asRecord(item);
        return {
          title: typeof o?.title === "string" ? o.title.slice(0, 180) : "",
          url: typeof o?.url === "string" ? o.url.slice(0, 300) : "",
          content: typeof o?.content === "string" ? o.content.slice(0, 500) : "",
        };
      });
      return packUntrusted("venice_web_search", { query, results: slim });
    }
    if (call.name === "venice_scrape") {
      const checked = inspectUrl(String(args.url ?? ""));
      if ("error" in checked) return `Tool error: ${checked.error}`;
      const json = asRecord(
        await postJson(ctx.key, "/augment/scrape", { url: checked.url.toString() }, ctx.signal),
      );
      const content = typeof json?.content === "string" ? json.content : "";
      return packUntrusted("venice_scrape", {
        url: typeof json?.url === "string" ? json.url : checked.url.toString(),
        format: json?.format ?? "markdown",
        content,
      });
    }
    if (call.name === "http_request") return await httpRequest(args, ctx);
    return `Tool error: unknown tool ${call.name}.`;
  } catch (err) {
    if (err instanceof VeniceError && (err.status === 401 || err.status === 402)) throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "request failed";
    return `Tool error: ${message}`.slice(0, 500);
  }
}

async function httpRequest(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const method = String(args.method ?? "GET").toUpperCase();
  if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method))
    return "Tool error: method not allowed.";
  const checked = inspectUrl(String(args.url ?? ""));
  if ("error" in checked) return `Tool error: ${checked.error}`;
  const host = checked.url.hostname.toLowerCase();
  const origin = checked.url.origin;
  const pathname = checked.url.pathname;
  const mutating = WRITE_METHODS.has(method);
  const headers = new Headers();
  const rawHeaders =
    typeof args.headers === "string" ? parseArgs(args.headers) : asRecord(args.headers);
  if (rawHeaders) {
    let n = 0;
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (n++ > 12) break;
      if (typeof v !== "string" || HEADER_BAN.has(k.toLowerCase())) continue;
      headers.set(k, v.slice(0, 200));
    }
  }
  const hasBody = mutating && typeof args.body === "string";
  const bodyText = hasBody ? String(args.body).slice(0, 16_000) : "";
  const decision = decideHttpPermission(ctx.httpIntegrations ?? [], listSessionGrants(), {
    origin,
    path: pathname,
    method,
    mutating,
    bodyBytes: bodyText.length,
  });
  if (decision.outcome === "deny") return `Tool error: ${decision.reason}`;
  if (decision.outcome === "confirm") {
    const ok = await ctx.confirmHttp({
      host,
      origin,
      method,
      path: `${pathname}${checked.url.search}`.slice(0, 180),
      pathname,
      mutating,
      bodyPreview: bodyText.slice(0, 240),
      bodyBytes: bodyText.length,
    });
    if (!ok) return `The user declined ${method} ${host}.`;
  }
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 20000);
  const onAbort = () => timeout.abort();
  ctx.signal.addEventListener("abort", onAbort);
  try {
    const res = await fetch(checked.url.toString(), {
      method,
      headers,
      body: hasBody ? bodyText : undefined,
      redirect: "manual",
      credentials: "omit",
      mode: "cors",
      signal: timeout.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        try {
          const next = inspectUrl(new URL(loc, checked.url).toString());
          if ("error" in next) return `Tool error: ${next.error}`;
        } catch {
          return "Tool error: The URL is not valid.";
        }
      }
      return "HTTP redirect was not followed.";
    }
    if (contentLengthOverLimit(res.headers)) {
      await res.body?.cancel().catch(() => undefined);
      return "Tool error: response body exceeds the 1 MiB tool limit.";
    }
    const read = await readBoundedBody(res.body);
    if (!read.ok) return `Tool error: ${read.error}`;
    return packUntrusted("http_request", {
      status: res.status,
      method,
      host,
      bytes: read.bytes,
      truncated: read.truncated,
      body: read.text,
    });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    const message = err instanceof Error ? err.message : "network error";
    return `Tool error: browser could not complete the request (${message}). Cross-origin APIs must allow this page.`;
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
  }
}

export function traitChoices(traits?: Record<string, string>): { value: string; label: string }[] {
  const labels: Record<string, string> = {
    default: "Default",
    most_intelligent: "Most intelligent",
    most_uncensored: "Most uncensored",
    default_reasoning: "Reasoning",
    function_calling_default: "Function calling",
    default_vision: "Vision",
    default_code: "Code",
  };
  const keys = traits && Object.keys(traits).length ? Object.keys(traits) : [...TRAITS];
  return keys.map((trait) => ({
    value: `trait:${trait}`,
    label: labels[trait] ?? trait.replace(/_/g, " "),
  }));
}
