import test from "node:test";
import assert from "node:assert/strict";
import {
  THEME_FAMILIES,
  THEME_PREVIEWS,
  loadAppearance,
  saveAppearance,
  resolveEffectiveMode,
  applyThemeToDom,
  contrastRatio,
  DEFAULT_APPEARANCE,
  APPEARANCE_STORAGE_KEY,
  type AppearanceSettings,
  type ThemeId,
} from "./theme.ts";

test("THEME: all 8 theme families are registered with valid dark and light previews", () => {
  const expectedThemes: ThemeId[] = [
    "ember",
    "catppuccin",
    "dracula",
    "github",
    "solarized",
    "gruvbox",
    "tokyo-night",
    "nord",
  ];

  assert.equal(THEME_FAMILIES.length, 8);
  for (const t of expectedThemes) {
    const family = THEME_FAMILIES.find((f) => f.id === t);
    assert.ok(family, `Family ${t} should be present`);
    assert.ok(THEME_PREVIEWS[t]?.dark?.bg, `${t} dark bg should exist`);
    assert.ok(THEME_PREVIEWS[t]?.light?.bg, `${t} light bg should exist`);
  }
});

test("THEME: WCAG AA contrast (>= 4.5:1) for primary text against background across all themes", () => {
  for (const family of THEME_FAMILIES) {
    const preview = THEME_PREVIEWS[family.id];

    // Dark mode text contrast
    const darkRatio = contrastRatio(preview.dark.text, preview.dark.bg);
    assert.ok(
      darkRatio >= 4.5,
      `${family.id} dark text contrast ${darkRatio.toFixed(2)} must be >= 4.5:1`,
    );

    // Light mode text contrast
    const lightRatio = contrastRatio(preview.light.text, preview.light.bg);
    assert.ok(
      lightRatio >= 4.5,
      `${family.id} light text contrast ${lightRatio.toFixed(2)} must be >= 4.5:1`,
    );
  }
});

test("THEME: loadAppearance provides safe defaults on empty or corrupt storage", () => {
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
    key() {
      return null;
    },
    length: 0,
  };

  // Empty
  const d1 = loadAppearance(mockStorage as unknown as Storage);
  assert.deepEqual(d1, DEFAULT_APPEARANCE);

  // Corrupt JSON
  mockStorage._data[APPEARANCE_STORAGE_KEY] = "not-json";
  const d2 = loadAppearance(mockStorage as unknown as Storage);
  assert.deepEqual(d2, DEFAULT_APPEARANCE);

  // Invalid theme and mode values fallback safely
  mockStorage._data[APPEARANCE_STORAGE_KEY] = JSON.stringify({
    theme: "unknown-theme",
    mode: "super-dark",
    orbShape: "tetrahedron",
  });
  const d3 = loadAppearance(mockStorage as unknown as Storage);
  assert.equal(d3.theme, "ember");
  assert.equal(d3.mode, "system");
  assert.equal(d3.orbShape, "sphere");
});

test("THEME: saveAppearance and loadAppearance round-trip custom settings", () => {
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
    key() {
      return null;
    },
    length: 0,
  };

  const custom: AppearanceSettings = {
    version: 1,
    theme: "nord",
    mode: "light",
    orbShape: "hexagon",
    orbFollowsTheme: false,
    reducedMotionOverride: "on",
  };

  const ok = saveAppearance(custom, mockStorage as unknown as Storage);
  assert.equal(ok, true);

  const loaded = loadAppearance(mockStorage as unknown as Storage);
  assert.deepEqual(loaded, custom);
});

test("THEME: resolveEffectiveMode respects explicit mode and system fallback", () => {
  assert.equal(resolveEffectiveMode("dark", false), "dark");
  assert.equal(resolveEffectiveMode("light", true), "light");
  assert.equal(resolveEffectiveMode("system", true), "dark");
  assert.equal(resolveEffectiveMode("system", false), "light");
});

test("THEME: applyThemeToDom updates DOM attributes and colorScheme", () => {
  const mockElement = {
    attrs: {} as Record<string, string>,
    style: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
  };

  const effective = applyThemeToDom("dracula", "dark", mockElement as unknown as HTMLElement);
  assert.equal(effective, "dark");
  assert.equal(mockElement.attrs["data-theme"], "dracula");
  assert.equal(mockElement.attrs["data-mode"], "dark");
  assert.equal(mockElement.style["colorScheme"], "dark");
});
