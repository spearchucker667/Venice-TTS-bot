/**
 * Reusable Profiles System for Ember
 * Supports built-in profiles and custom user-saved profiles stored in ember.profiles.v1.
 */

import type {
  FlowId,
  LampId,
  Persona,
  PresetId,
  PromptMode,
  SearchMode,
  ThinkingMode,
} from "./state.ts";
import type { OrbShapeId } from "./theme.ts";

export type SavedProfile = {
  id: string;
  name: string;
  description: string;
  textModel?: string;
  systemPrompt?: string;
  characterSlug?: string;
  promptMode?: PromptMode;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  preset?: PresetId;
  thinking?: ThinkingMode;
  webSearch?: SearchMode;
  tools?: boolean;
  ttsModel?: string;
  voice?: string;
  speed?: number;
  lamp?: LampId;
  flow?: FlowId;
  orbShape?: OrbShapeId;
};

export const BUILTIN_PROFILES: readonly SavedProfile[] = [
  {
    id: "coding",
    name: "Coding",
    description: "Precise parameters, tools enabled for API inspection, and coding temperature.",
    preset: "coding",
    temperature: 0.2,
    topP: 0.9,
    thinking: "live",
    tools: true,
    webSearch: "auto",
  },
  {
    id: "research",
    name: "Research",
    description: "Balanced reasoning with web search active for current facts and citations.",
    preset: "reasoning",
    temperature: 0.5,
    topP: 0.95,
    thinking: "live",
    tools: true,
    webSearch: "on",
  },
  {
    id: "roleplay",
    name: "Roleplay",
    description: "Creative temperature and expressive character voice blending.",
    preset: "creative",
    temperature: 1.1,
    topP: 0.95,
    promptMode: "character",
    webSearch: "off",
  },
  {
    id: "voice-chat",
    name: "Voice Chat",
    description: "Short spoken sentences optimized for quick back-and-forth verbal interaction.",
    preset: "balanced",
    temperature: 0.7,
    topP: 1.0,
    thinking: "stripped",
    speed: 1.05,
    webSearch: "auto",
  },
  {
    id: "fast",
    name: "Fast",
    description: "Minimal latency and compact completions.",
    preset: "balanced",
    temperature: 0.6,
    topP: 0.9,
    maxTokens: 512,
    thinking: "off",
    webSearch: "off",
  },
  {
    id: "deep-reasoning",
    name: "Deep Reasoning",
    description: "Full open thinking traces and reflective generation.",
    preset: "reasoning",
    temperature: 0.6,
    topP: 1.0,
    thinking: "live",
    maxTokens: 4096,
  },
];

export const PROFILES_STORAGE_KEY = "ember.profiles.v1";

/**
 * Load user-saved profiles from storage.
 */
export function loadSavedProfiles(storage?: Storage): SavedProfile[] {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return [];
    const raw = s.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidProfile);
  } catch {
    return [];
  }
}

/**
 * Save user profiles to storage.
 */
export function saveCustomProfiles(profiles: SavedProfile[], storage?: Storage): boolean {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return false;
    s.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles.slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}

function isValidProfile(v: unknown): v is SavedProfile {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === "string" && p.id.trim().length > 0 && typeof p.name === "string";
}

/**
 * Applies a profile's non-empty fields onto an existing Persona cleanly.
 */
export function applyProfileToPersona(
  profile: SavedProfile,
  _current: Persona,
): { personaPatch: Partial<Persona>; orbShape?: OrbShapeId } {
  const patch: Partial<Persona> = {};

  if (profile.textModel) patch.textModel = profile.textModel;
  if (profile.systemPrompt) patch.systemPrompt = profile.systemPrompt;
  if (profile.characterSlug !== undefined) patch.characterSlug = profile.characterSlug;
  if (profile.promptMode) patch.promptMode = profile.promptMode;
  if (typeof profile.temperature === "number") patch.temperature = profile.temperature;
  if (typeof profile.topP === "number") patch.topP = profile.topP;
  if (typeof profile.maxTokens === "number") patch.maxTokens = profile.maxTokens;
  if (profile.preset) patch.preset = profile.preset;
  if (profile.thinking) patch.thinking = profile.thinking;
  if (profile.webSearch) patch.webSearch = profile.webSearch;
  if (typeof profile.tools === "boolean") patch.tools = profile.tools;
  if (profile.ttsModel) patch.ttsModel = profile.ttsModel;
  if (profile.voice) patch.voice = profile.voice;
  if (typeof profile.speed === "number") patch.speed = profile.speed;
  if (profile.lamp) patch.lamp = profile.lamp;
  if (profile.flow) patch.flow = profile.flow;

  return {
    personaPatch: patch,
    orbShape: profile.orbShape,
  };
}
