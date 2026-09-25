import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_PROFILES,
  PROFILES_STORAGE_KEY,
  loadSavedProfiles,
  saveCustomProfiles,
  applyProfileToPersona,
  type SavedProfile,
} from "./profiles.ts";
import { DEFAULT_PERSONA, type Persona } from "./state.ts";

test("PROFILES: all 6 built-in profiles exist with descriptive metadata", () => {
  const expectedIds = ["coding", "research", "roleplay", "voice-chat", "fast", "deep-reasoning"];
  assert.equal(BUILTIN_PROFILES.length, 6);
  for (const id of expectedIds) {
    const p = BUILTIN_PROFILES.find((x) => x.id === id);
    assert.ok(p, `Built-in profile ${id} must exist`);
    assert.ok(p.name.length > 0, `Profile ${id} must have a name`);
    assert.ok(p.description.length > 0, `Profile ${id} must have a description`);
  }
});

test("PROFILES: applyProfileToPersona applies defined fields without clobbering unspecified fields", () => {
  const basePersona: Persona = {
    ...DEFAULT_PERSONA,
    textModel: "default-model",
    voice: "Ember Voice",
    temperature: 0.8,
    topP: 1.0,
    tools: false,
    webSearch: "off",
  };

  const codingProfile = BUILTIN_PROFILES.find((p) => p.id === "coding")!;
  const result = applyProfileToPersona(codingProfile, basePersona);

  assert.equal(result.personaPatch.temperature, 0.2);
  assert.equal(result.personaPatch.topP, 0.9);
  assert.equal(result.personaPatch.tools, true);
  assert.equal(result.personaPatch.webSearch, "auto");
  assert.equal(result.personaPatch.textModel, undefined); // coding doesn't force a specific text model
  assert.equal(result.personaPatch.voice, undefined); // coding doesn't force a voice
});

test("PROFILES: applyProfileToPersona handles orbShape if configured", () => {
  const customProfile: SavedProfile = {
    id: "sci-fi",
    name: "Sci-Fi",
    description: "Futuristic configuration",
    orbShape: "capsule",
    temperature: 0.9,
  };

  const basePersona: Persona = { ...DEFAULT_PERSONA };
  const result = applyProfileToPersona(customProfile, basePersona);
  assert.equal(result.personaPatch.temperature, 0.9);
  assert.equal(result.orbShape, "capsule");
});

test("PROFILES: storage round-trip and validation fallback", () => {
  const mockStorage = {
    _data: {} as Record<string, string>,
    getItem(k: string) {
      return this._data[k] ?? null;
    },
    setItem(k: string, v: string) {
      this._data[k] = v;
    },
    removeItem(k: string) {
      delete this._data[k];
    },
    clear() {
      this._data = {};
    },
    get length() {
      return Object.keys(this._data).length;
    },
    key(i: number) {
      return Object.keys(this._data)[i] ?? null;
    },
  };

  // Empty storage returns empty list
  assert.deepEqual(loadSavedProfiles(mockStorage), []);

  // Malformed JSON returns empty list
  mockStorage.setItem(PROFILES_STORAGE_KEY, "{ bad json }");
  assert.deepEqual(loadSavedProfiles(mockStorage), []);

  // Saving custom profiles
  const profilesToSave: SavedProfile[] = [
    { id: "custom-1", name: "Custom One", description: "First custom" },
    { id: "custom-2", name: "Custom Two", description: "Second custom" },
  ];
  const ok = saveCustomProfiles(profilesToSave, mockStorage);
  assert.equal(ok, true);

  const loaded = loadSavedProfiles(mockStorage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0]?.id, "custom-1");
  assert.equal(loaded[1]?.id, "custom-2");

  // Invalid entries filtered out
  mockStorage.setItem(
    PROFILES_STORAGE_KEY,
    JSON.stringify([
      { id: "valid", name: "Valid" },
      { name: "Missing ID" },
      null,
      123,
      { id: "", name: "Empty ID" },
    ]),
  );
  const filtered = loadSavedProfiles(mockStorage);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "valid");
});
