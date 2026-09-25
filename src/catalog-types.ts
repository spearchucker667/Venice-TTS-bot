/**
 * Shared catalog types for Venice discovery output.
 *
 * These types describe normalized, provider-reported data only — nothing here
 * is invented client-side. Fields are populated exclusively by the pure
 * adapters in catalog-normalize.ts from shapes the API demonstrably returns.
 */

/**
 * VEN-001: Venice's compatibility mapping endpoint returns an
 * alias/provider-name → canonical model ID mapping (string → string), not the
 * legacy array-of-strings shape the old parser expected.
 */
export type CompatibilityMap = Record<string, string>;

/** A money rate with an explicit unit, e.g. { amount: 2.5, unit: "1M input tokens" }. */
export type MoneyRate = { amount: number; unit: string } | null;

/**
 * VEN-003: normalized capability descriptor derived from a Venice model_spec.
 * `null` means the catalog did not report the capability; `false`/`true` are
 * explicit provider statements. Callers must treat `null` as "unknown", never
 * as "unsupported".
 */
export type ModelCapabilities = {
  tools: boolean | null;
  reasoning: boolean | null;
  vision: boolean | null;
  webSearch: boolean | null;
  streaming: boolean | null;
  temperature: boolean | null;
  topP: boolean | null;
  frequencyPenalty: boolean | null;
  presencePenalty: boolean | null;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  /** VEN-005: advertised reasoning-effort values, only when the spec exposes a list. */
  reasoningEffortValues: string[] | null;
  privacyTier: string;
  inputPrice: MoneyRate;
  outputPrice: MoneyRate;
};
