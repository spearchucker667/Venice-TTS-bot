/**
 * Settings Export & Import System for Ember
 * Provides versioned SettingsExportV1 backups separate from conversation logs.
 * Strictly guarantees that API keys and authentication tokens are NEVER exported.
 */

import type { Persona } from "./state.ts";
import type { AppearanceSettings } from "./theme.ts";
import type { SavedProfile } from "./profiles.ts";

export type SettingsExportV1 = {
  version: 1;
  exportedAt: string;
  appearance: AppearanceSettings;
  defaults: {
    textModel?: string;
    ttsModel?: string;
    voice?: string;
    sttModel?: string;
    speed?: number;
    vad?: number;
    promptMode?: Persona["promptMode"];
    generation?: {
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      frequencyPenalty?: number;
      presencePenalty?: number;
      preset?: Persona["preset"];
      thinking?: Persona["thinking"];
      webSearch?: Persona["webSearch"];
      tools?: boolean;
    };
  };
  profiles?: SavedProfile[];
};

export const MAX_SETTINGS_IMPORT_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Creates a sanitized, key-free settings export.
 */
export function createSettingsExport(
  appearance: AppearanceSettings,
  persona: Persona,
  profiles: SavedProfile[] = [],
): SettingsExportV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appearance: {
      version: 1,
      theme: appearance.theme,
      mode: appearance.mode,
      orbShape: appearance.orbShape,
      orbFollowsTheme: appearance.orbFollowsTheme,
      reducedMotionOverride: appearance.reducedMotionOverride,
    },
    defaults: {
      textModel: persona.textModel,
      ttsModel: persona.ttsModel,
      voice: persona.voice,
      sttModel: persona.sttModel,
      speed: persona.speed,
      vad: persona.vad,
      promptMode: persona.promptMode,
      generation: {
        temperature: persona.temperature,
        topP: persona.topP,
        maxTokens: persona.maxTokens,
        frequencyPenalty: persona.frequencyPenalty,
        presencePenalty: persona.presencePenalty,
        preset: persona.preset,
        thinking: persona.thinking,
        webSearch: persona.webSearch,
        tools: persona.tools,
      },
    },
    profiles: profiles.map((p) => ({ ...p })),
  };
}

/**
 * Parses and strictly validates a settings export payload.
 */
export function parseSettingsExport(
  rawText: string,
): { ok: true; data: SettingsExportV1 } | { ok: false; error: string } {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { ok: false, error: "Settings payload is empty." };
  }

  if (rawText.length > MAX_SETTINGS_IMPORT_BYTES) {
    return { ok: false, error: "Settings file exceeds 2 MB limit." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Invalid JSON format." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Settings data must be a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.version !== 1) {
    if (typeof obj.version === "number" && obj.version > 1) {
      return {
        ok: false,
        error: `Incompatible settings version (${obj.version}). This version of Ember supports version 1.`,
      };
    }
    return { ok: false, error: "Missing or unsupported settings schema version." };
  }

  // Appearance validation
  if (!obj.appearance || typeof obj.appearance !== "object") {
    return { ok: false, error: "Missing appearance settings in payload." };
  }

  const app = obj.appearance as Record<string, unknown>;
  const validThemes = [
    "ember",
    "catppuccin",
    "dracula",
    "github",
    "solarized",
    "gruvbox",
    "tokyo-night",
    "nord",
  ];
  const validModes = ["system", "light", "dark"];
  const validShapes = [
    "sphere",
    "oval",
    "rounded-square",
    "triangle",
    "diamond",
    "hexagon",
    "capsule",
  ];

  const appearance: AppearanceSettings = {
    version: 1,
    theme: validThemes.includes(app.theme as string)
      ? (app.theme as AppearanceSettings["theme"])
      : "ember",
    mode: validModes.includes(app.mode as string)
      ? (app.mode as AppearanceSettings["mode"])
      : "system",
    orbShape: validShapes.includes(app.orbShape as string)
      ? (app.orbShape as AppearanceSettings["orbShape"])
      : "sphere",
    orbFollowsTheme: typeof app.orbFollowsTheme === "boolean" ? app.orbFollowsTheme : true,
    reducedMotionOverride:
      app.reducedMotionOverride === "on" || app.reducedMotionOverride === "off"
        ? app.reducedMotionOverride
        : "system",
  };

  const def = (obj.defaults && typeof obj.defaults === "object" ? obj.defaults : {}) as Record<
    string,
    unknown
  >;
  const gen = (
    def.generation && typeof def.generation === "object" ? def.generation : {}
  ) as Record<string, unknown>;

  const defaults: SettingsExportV1["defaults"] = {
    textModel: typeof def.textModel === "string" ? def.textModel : undefined,
    ttsModel: typeof def.ttsModel === "string" ? def.ttsModel : undefined,
    voice: typeof def.voice === "string" ? def.voice : undefined,
    sttModel: typeof def.sttModel === "string" ? def.sttModel : undefined,
    speed: typeof def.speed === "number" ? def.speed : undefined,
    vad: typeof def.vad === "number" ? def.vad : undefined,
    promptMode:
      def.promptMode === "blend" || def.promptMode === "persona" || def.promptMode === "character"
        ? def.promptMode
        : undefined,
    generation: {
      temperature: typeof gen.temperature === "number" ? gen.temperature : undefined,
      topP: typeof gen.topP === "number" ? gen.topP : undefined,
      maxTokens: typeof gen.maxTokens === "number" ? gen.maxTokens : undefined,
      frequencyPenalty: typeof gen.frequencyPenalty === "number" ? gen.frequencyPenalty : undefined,
      presencePenalty: typeof gen.presencePenalty === "number" ? gen.presencePenalty : undefined,
      preset:
        gen.preset === "balanced" ||
        gen.preset === "creative" ||
        gen.preset === "coding" ||
        gen.preset === "reasoning" ||
        gen.preset === "custom"
          ? gen.preset
          : undefined,
      thinking:
        gen.thinking === "live" || gen.thinking === "stripped" || gen.thinking === "off"
          ? gen.thinking
          : undefined,
      webSearch:
        gen.webSearch === "auto" || gen.webSearch === "on" || gen.webSearch === "off"
          ? gen.webSearch
          : undefined,
      tools: typeof gen.tools === "boolean" ? gen.tools : undefined,
    },
  };

  const profiles: SavedProfile[] = [];
  if (Array.isArray(obj.profiles)) {
    for (const p of obj.profiles) {
      if (p && typeof p === "object" && typeof p.id === "string" && typeof p.name === "string") {
        profiles.push({
          id: p.id,
          name: p.name,
          description: typeof p.description === "string" ? p.description : "",
          textModel: typeof p.textModel === "string" ? p.textModel : undefined,
          systemPrompt: typeof p.systemPrompt === "string" ? p.systemPrompt : undefined,
          characterSlug: typeof p.characterSlug === "string" ? p.characterSlug : undefined,
          temperature: typeof p.temperature === "number" ? p.temperature : undefined,
          topP: typeof p.topP === "number" ? p.topP : undefined,
          maxTokens: typeof p.maxTokens === "number" ? p.maxTokens : undefined,
          preset: typeof p.preset === "string" ? (p.preset as Persona["preset"]) : undefined,
          tools: typeof p.tools === "boolean" ? p.tools : undefined,
          ttsModel: typeof p.ttsModel === "string" ? p.ttsModel : undefined,
          voice: typeof p.voice === "string" ? p.voice : undefined,
          speed: typeof p.speed === "number" ? p.speed : undefined,
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      version: 1,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString(),
      appearance,
      defaults,
      profiles,
    },
  };
}
