import test from "node:test";
import assert from "node:assert/strict";
import {
  createSettingsExport,
  parseSettingsExport,
  MAX_SETTINGS_IMPORT_BYTES,
  type SettingsExportV1,
} from "./settings-export.ts";
import { DEFAULT_PERSONA, type Persona } from "./state.ts";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "./theme.ts";
import type { SavedProfile } from "./profiles.ts";

test("SETTINGS-EXPORT: createSettingsExport creates sanitized V1 export without secrets", () => {
  const appearance: AppearanceSettings = {
    ...DEFAULT_APPEARANCE,
    theme: "solarized",
    mode: "dark",
    orbShape: "diamond",
  };

  const persona: Persona = {
    ...DEFAULT_PERSONA,
    textModel: "meta-llama/llama-3.3-70b-instruct",
    ttsModel: "tts-v1",
    voice: "Ember Voice",
    temperature: 0.7,
    topP: 0.95,
  };

  const profiles: SavedProfile[] = [
    {
      id: "coding-1",
      name: "Custom Coding",
      description: "My coding configuration",
      temperature: 0.1,
    },
  ];

  const exportData = createSettingsExport(appearance, persona, profiles);

  assert.equal(exportData.version, 1);
  assert.ok(exportData.exportedAt.length > 0);
  assert.equal(exportData.appearance.theme, "solarized");
  assert.equal(exportData.appearance.orbShape, "diamond");
  assert.equal(exportData.defaults.textModel, "meta-llama/llama-3.3-70b-instruct");
  assert.equal(exportData.profiles?.length, 1);

  // Guarantee: No apiKey, tokens, or conversation turns in serialization
  const serialized = JSON.stringify(exportData);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("turns"), false);
  assert.equal(serialized.includes("authorization"), false);
});

test("SETTINGS-EXPORT: parseSettingsExport successfully parses valid payload", () => {
  const sampleExport: SettingsExportV1 = {
    version: 1,
    exportedAt: new Date().toISOString(),
    appearance: {
      version: 1,
      theme: "nord",
      mode: "light",
      orbShape: "capsule",
      orbFollowsTheme: false,
      reducedMotionOverride: "off",
    },
    defaults: {
      textModel: "deepseek-ai/DeepSeek-V3",
      ttsModel: "tts-v1",
      voice: "Nicole",
      speed: 1.1,
      generation: {
        temperature: 0.5,
        topP: 0.8,
        thinking: "live",
        tools: true,
      },
    },
    profiles: [
      {
        id: "profile-a",
        name: "Profile A",
        description: "Test description",
        temperature: 0.4,
      },
    ],
  };

  const raw = JSON.stringify(sampleExport);
  const result = parseSettingsExport(raw);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.version, 1);
    assert.equal(result.data.appearance.theme, "nord");
    assert.equal(result.data.appearance.mode, "light");
    assert.equal(result.data.appearance.orbShape, "capsule");
    assert.equal(result.data.defaults.textModel, "deepseek-ai/DeepSeek-V3");
    assert.equal(result.data.defaults.generation?.temperature, 0.5);
    assert.equal(result.data.profiles?.length, 1);
  }
});

test("SETTINGS-EXPORT: parseSettingsExport rejects empty or oversized payloads", () => {
  assert.equal(parseSettingsExport("").ok, false);
  assert.equal(parseSettingsExport("   ").ok, false);

  // Payload > 2MB
  const hugePayload = "a".repeat(MAX_SETTINGS_IMPORT_BYTES + 10);
  const result = parseSettingsExport(hugePayload);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.includes("2 MB"));
  }
});

test("SETTINGS-EXPORT: parseSettingsExport validates schema version and structure", () => {
  // Invalid JSON
  assert.equal(parseSettingsExport("{ bad json").ok, false);

  // Non-object
  assert.equal(parseSettingsExport("12345").ok, false);

  // Incompatible version > 1
  const futureVersion = JSON.stringify({ version: 2, appearance: {} });
  const futureRes = parseSettingsExport(futureVersion);
  assert.equal(futureRes.ok, false);
  if (!futureRes.ok) {
    assert.ok(futureRes.error.includes("Incompatible settings version"));
  }

  // Missing version
  assert.equal(parseSettingsExport(JSON.stringify({ appearance: {} })).ok, false);

  // Missing appearance
  assert.equal(parseSettingsExport(JSON.stringify({ version: 1 })).ok, false);
});

test("SETTINGS-EXPORT: fallback for invalid enum values in appearance", () => {
  const corruptedPayload = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    appearance: {
      version: 1,
      theme: "unknown-funky-theme",
      mode: "non-existent-mode",
      orbShape: "invalid-shape",
    },
    defaults: {},
  });

  const res = parseSettingsExport(corruptedPayload);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.appearance.theme, "ember");
    assert.equal(res.data.appearance.mode, "system");
    assert.equal(res.data.appearance.orbShape, "sphere");
  }
});
