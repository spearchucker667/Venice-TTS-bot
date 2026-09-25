/**
 * Pure adapters between Venice provider JSON and Ember's normalized catalog
 * state (VEN-001, VEN-003, VEN-005, VEN-007, VEN-011). Everything here is
 * side-effect free and fixture-testable; no fetch, no storage.
 */

import type { CompatibilityMap, ModelCapabilities, MoneyRate } from "./catalog-types.ts";

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

const IGNORED_BAG_KEYS = new Set(["object", "type", "data"]);

/* ------------------------------------------------------------------ */
/* VEN-001 — compatibility mapping                                     */
/* ------------------------------------------------------------------ */

export type CompatParseResult = {
  /** alias/provider name → canonical model ID. */
  map: CompatibilityMap;
  /** True when only the legacy string-lists shape was recognized. */
  legacy: boolean;
  /**
   * False when the payload carried data but matched neither the documented
   * mapping shape nor the legacy array shape (schema drift). Callers should
   * keep their previously cached mapping and warn instead of adopting `{}`.
   */
  recognized: boolean;
};

function cleanKey(key: string): string {
  return key.trim().slice(0, 120);
}

function cleanId(value: string): string {
  return value.trim().slice(0, 160);
}

/**
 * Parse the `/models/compatibility_mapping` payload.
 *
 * Documented shape (Venice integration guidance): a flat mapping from
 * alias/provider compatibility name to canonical model ID. The legacy shape
 * stored lists of compatible canonical IDs per alias; for that shape the
 * first listed ID is the canonical mapping and the rest are folded into
 * `legacyAliases` consumers may still display.
 */
export function parseCompatibilityMap(json: unknown): CompatParseResult {
  const root = asRecord(json);
  const data = asRecord(root?.data) ?? root;
  if (!data) return { map: {}, legacy: false, recognized: true };

  const map: CompatibilityMap = {};
  let sawStringValue = false;
  let sawStringList = false;
  let sawOtherData = false;

  for (const [rawKey, value] of Object.entries(data)) {
    const key = cleanKey(rawKey);
    if (!key || IGNORED_BAG_KEYS.has(key)) continue;
    if (typeof value === "string") {
      const id = cleanId(value);
      if (id) {
        map[key] = id;
        sawStringValue = true;
      }
    } else if (Array.isArray(value)) {
      const ids = value
        .filter((v): v is string => typeof v === "string")
        .map(cleanId)
        .filter(Boolean);
      if (ids.length === value.length && ids.length > 0) {
        // Legacy shape: alias → [canonical, …aliases]. First entry is the
        // canonical ID the provider name resolves to.
        sawStringList = true;
        if (!(key in map)) map[key] = ids[0] as string;
      } else if (value.length > 0) {
        sawOtherData = true;
      }
    } else if (value !== null && value !== undefined) {
      sawOtherData = true;
    }
  }

  if (Object.keys(map).length > 0) {
    return { map, legacy: sawStringList && !sawStringValue, recognized: true };
  }
  if (sawOtherData) return { map: {}, legacy: false, recognized: false };
  return { map: {}, legacy: false, recognized: true };
}

/** Derive the display form (`Record<alias, string[]>`) from a canonical map. */
export function compatArraysFromMap(map: CompatibilityMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [alias, canonical] of Object.entries(map)) {
    out[alias] = [canonical];
  }
  return out;
}

/** Migrate a legacy cached `Record<alias, string[]>` into a canonical map (first entry wins). */
export function compatMapFromArrays(
  arrays: Record<string, string[]> | null | undefined,
): CompatibilityMap {
  const out: CompatibilityMap = {};
  if (!arrays) return out;
  for (const [alias, ids] of Object.entries(arrays)) {
    const first = Array.isArray(ids)
      ? ids.find((id) => typeof id === "string" && id.trim())
      : undefined;
    if (first) out[cleanKey(alias)] = cleanId(first);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* VEN-003 — capability adapter                                        */
/* ------------------------------------------------------------------ */

function booleanBag(spec: Record<string, unknown> | null): Record<string, boolean> {
  const caps = asRecord(spec?.capabilities);
  const out: Record<string, boolean> = {};
  if (!caps) return out;
  for (const [key, value] of Object.entries(caps)) {
    if (typeof value === "boolean") out[key.toLowerCase()] = value;
  }
  return out;
}

function flagFromKeys(bag: Record<string, boolean>, pattern: RegExp): boolean | null {
  const keys = Object.keys(bag).filter((k) => pattern.test(k));
  if (keys.length === 0) return null;
  return keys.some((k) => bag[k]);
}

/** Scan a constraints-style record for a numeric max-output key. */
function numericByPattern(node: unknown, pattern: RegExp): number | null {
  const rec = asRecord(node);
  if (!rec) return null;
  for (const [key, value] of Object.entries(rec)) {
    if (!pattern.test(key)) continue;
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function maxOutputTokens(
  spec: Record<string, unknown> | null,
  row: Record<string, unknown>,
): number | null {
  const direct =
    asPositiveInt(spec?.maxOutputTokens) ??
    asPositiveInt(spec?.max_output_tokens) ??
    asPositiveInt(row.maxOutputTokens) ??
    asPositiveInt(row.max_output_tokens);
  if (direct !== null) return direct;
  return (
    numericByPattern(asRecord(spec?.constraints), /max.?output/i) ??
    numericByPattern(asRecord(row.constraints), /max.?output/i)
  );
}

function maxContextTokens(
  spec: Record<string, unknown> | null,
  row: Record<string, unknown>,
): number | null {
  const raw = spec?.availableContextTokens ?? row.availableContextTokens ?? spec?.context_length;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** VEN-005: advertised reasoning-effort values, only from an explicit string list in the spec. */
function reasoningEffortValues(spec: Record<string, unknown> | null): string[] | null {
  const caps = asRecord(spec?.capabilities);
  if (!caps) return null;
  for (const [key, value] of Object.entries(caps)) {
    if (!/effort/i.test(key)) continue;
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
      const values = (value as string[])
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 12);
      if (values.length) return values;
    }
  }
  return null;
}

function privacyTier(spec: Record<string, unknown> | null, row: Record<string, unknown>): string {
  const raw = spec?.privacy ?? row.privacy;
  if (typeof raw === "string") return raw.slice(0, 40);
  const bag = asRecord(raw);
  const bit = bag?.type ?? bag?.tier ?? bag?.level;
  return typeof bit === "string" ? bit.slice(0, 40) : "";
}

/* ------------------------------------------------------------------ */
/* VEN-007 — pricing normalization                                     */
/* ------------------------------------------------------------------ */

function moneyRate(value: unknown, unitHint: unknown): MoneyRate {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const unit = typeof unitHint === "string" ? unitHint.trim().slice(0, 40) : "";
  return { amount: value, unit };
}

export function inputRate(pricing: Record<string, unknown> | null): MoneyRate {
  if (!pricing) return null;
  return moneyRate(
    pricing.input ?? pricing.prompt,
    pricing.input_unit ?? pricing.inputUnit ?? pricing.unit,
  );
}

export function outputRate(pricing: Record<string, unknown> | null): MoneyRate {
  if (!pricing) return null;
  return moneyRate(
    pricing.output ?? pricing.completion,
    pricing.output_unit ?? pricing.outputUnit ?? pricing.unit,
  );
}

function trimAmount(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * VEN-007: never show a bare number. With explicit unit metadata the raw value
 * is shown with that unit. Without metadata, values that look like per-token
 * rates are normalized to "$ / 1M tokens"; anything else is hidden (null)
 * rather than displayed with a invented unit.
 */
export function moneyRateLabel(rate: MoneyRate, kind: "input" | "output"): string | null {
  if (!rate) return null;
  const { amount, unit } = rate;
  if (unit) return `$${trimAmount(amount)} / ${unit}`;
  if (amount === 0) return "$0";
  if (amount > 0 && amount < 0.01) {
    return `$${trimAmount(amount * 1_000_000)} / 1M ${kind} tokens`;
  }
  return null;
}

/** Combined pricing label for a model row; "" when nothing displayable remains. */
export function priceLabelFromRates(input: MoneyRate, output: MoneyRate): string {
  const parts = [moneyRateLabel(input, "input"), moneyRateLabel(output, "output")].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* VEN-003 — the normalized model descriptor                           */
/* ------------------------------------------------------------------ */

export function normalizeCapabilities(
  spec: Record<string, unknown> | null,
  row: Record<string, unknown>,
): ModelCapabilities {
  const bag = booleanBag(spec);
  return {
    tools: flagFromKeys(bag, /tool|function/i),
    reasoning: flagFromKeys(bag, /reason|think/i),
    vision: flagFromKeys(bag, /vision|image/i),
    webSearch: flagFromKeys(bag, /web.?search|internet|browse/i),
    streaming: flagFromKeys(bag, /stream/i),
    temperature: flagFromKeys(bag, /temperature/i),
    topP: flagFromKeys(bag, /top.?p/i),
    frequencyPenalty: flagFromKeys(bag, /frequency/i),
    presencePenalty: flagFromKeys(bag, /presence/i),
    maxContextTokens: maxContextTokens(spec, row),
    maxOutputTokens: maxOutputTokens(spec, row),
    reasoningEffortValues: reasoningEffortValues(spec),
    privacyTier: privacyTier(spec, row),
    inputPrice: inputRate(asRecord(spec?.pricing)),
    outputPrice: outputRate(asRecord(spec?.pricing)),
  };
}

/* ------------------------------------------------------------------ */
/* VEN-005 — reasoning effort gating                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve a requested reasoning effort against the values the selected model
 * advertises. Returns null (send nothing) when the model does not advertise
 * reasoning-effort support or the requested value is not among the advertised
 * values — the request must never carry a hardcoded global enum.
 */
export function resolveReasoningEffort(
  capabilities: ModelCapabilities | null | undefined,
  requested: string | null | undefined,
): string | null {
  const value = (requested ?? "").trim();
  if (!value || !capabilities) return null;
  const accepted = capabilities.reasoningEffortValues;
  if (!accepted || accepted.length === 0) return null;
  return accepted.includes(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* VEN-011 — finish_reason normalization                               */
/* ------------------------------------------------------------------ */

export const FINISH_REASONS = ["stop", "length", "content_filter", "tool_calls", "error"] as const;
export type FinishReason = (typeof FINISH_REASONS)[number] | (string & {});

const FINISH_ALIASES: Record<string, FinishReason> = {
  stop: "stop",
  length: "length",
  max_tokens: "length",
  max_length: "length",
  context_limit: "length",
  content_filter: "content_filter",
  contentfilter: "content_filter",
  content_filtered: "content_filter",
  tool_calls: "tool_calls",
  tool_call: "tool_calls",
  toolcalls: "tool_calls",
  error: "error",
  errored: "error",
  aborted: "error",
};

/** Normalize a provider finish_reason into a canonical value; unknown reasons pass through. */
export function normalizeFinishReason(raw: unknown): FinishReason | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key) return null;
  return FINISH_ALIASES[key] ?? key;
}
