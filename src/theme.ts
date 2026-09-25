/**
 * Theme Engine for Ember
 * Implements token contract, theme families, mode resolution, pre-hydration DOM application,
 * and appearance settings persistence.
 */

export type ThemeId =
  "ember" | "catppuccin" | "dracula" | "github" | "solarized" | "gruvbox" | "tokyo-night" | "nord";

export type ThemeMode = "system" | "light" | "dark";

export type OrbShapeId =
  "sphere" | "oval" | "rounded-square" | "triangle" | "diamond" | "hexagon" | "capsule";

export type AppearanceSettings = {
  version: 1;
  theme: ThemeId;
  mode: ThemeMode;
  orbShape: OrbShapeId;
  orbFollowsTheme: boolean;
  reducedMotionOverride: "system" | "on" | "off";
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  version: 1,
  theme: "ember",
  mode: "system",
  orbShape: "sphere",
  orbFollowsTheme: true,
  reducedMotionOverride: "system",
};

export const THEME_FAMILIES: {
  id: ThemeId;
  name: string;
  darkLabel: string;
  lightLabel: string;
  source: string;
}[] = [
  {
    id: "ember",
    name: "Ember",
    darkLabel: "Ember Dark",
    lightLabel: "Ember Light",
    source: "Ember native palette",
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    darkLabel: "Mocha",
    lightLabel: "Latte",
    source: "https://catppuccin.com/palette",
  },
  {
    id: "dracula",
    name: "Dracula",
    darkLabel: "Dracula",
    lightLabel: "Dracula Light",
    source: "https://draculatheme.com",
  },
  {
    id: "github",
    name: "GitHub",
    darkLabel: "GitHub Dark",
    lightLabel: "GitHub Light",
    source: "https://primer.style/primitives/colors",
  },
  {
    id: "solarized",
    name: "Solarized",
    darkLabel: "Solarized Dark",
    lightLabel: "Solarized Light",
    source: "https://ethanschoonover.com/solarized",
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    darkLabel: "Gruvbox Dark",
    lightLabel: "Gruvbox Light",
    source: "https://github.com/morhetz/gruvbox",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    darkLabel: "Tokyo Night",
    lightLabel: "Tokyo Day",
    source: "https://github.com/enkia/tokyo-night-vscode-theme",
  },
  {
    id: "nord",
    name: "Nord",
    darkLabel: "Nord Dark",
    lightLabel: "Nord Light",
    source: "https://www.nordtheme.com",
  },
];

export const ORB_SHAPES: { id: OrbShapeId; label: string }[] = [
  { id: "sphere", label: "Sphere" },
  { id: "oval", label: "Oval" },
  { id: "rounded-square", label: "Square" },
  { id: "triangle", label: "Triangle" },
  { id: "diamond", label: "Diamond" },
  { id: "hexagon", label: "Hexagon" },
  { id: "capsule", label: "Capsule" },
];

export const APPEARANCE_STORAGE_KEY = "ember.appearance.v1";

/**
 * Load appearance settings with schema validation and safe defaults.
 */
export function loadAppearance(storage?: Storage): AppearanceSettings {
  try {
    const raw = storage
      ? storage.getItem(APPEARANCE_STORAGE_KEY)
      : typeof localStorage !== "undefined"
        ? localStorage.getItem(APPEARANCE_STORAGE_KEY)
        : null;
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_APPEARANCE };

    const validThemes: ThemeId[] = [
      "ember",
      "catppuccin",
      "dracula",
      "github",
      "solarized",
      "gruvbox",
      "tokyo-night",
      "nord",
    ];
    const validModes: ThemeMode[] = ["system", "light", "dark"];
    const validShapes: OrbShapeId[] = [
      "sphere",
      "oval",
      "rounded-square",
      "triangle",
      "diamond",
      "hexagon",
      "capsule",
    ];
    const validMotions = ["system", "on", "off"] as const;

    const theme = validThemes.includes(parsed.theme) ? parsed.theme : DEFAULT_APPEARANCE.theme;
    const mode = validModes.includes(parsed.mode) ? parsed.mode : DEFAULT_APPEARANCE.mode;
    const orbShape = validShapes.includes(parsed.orbShape)
      ? parsed.orbShape
      : DEFAULT_APPEARANCE.orbShape;
    const orbFollowsTheme =
      typeof parsed.orbFollowsTheme === "boolean"
        ? parsed.orbFollowsTheme
        : DEFAULT_APPEARANCE.orbFollowsTheme;
    const reducedMotionOverride = validMotions.includes(parsed.reducedMotionOverride)
      ? parsed.reducedMotionOverride
      : DEFAULT_APPEARANCE.reducedMotionOverride;

    return {
      version: 1,
      theme,
      mode,
      orbShape,
      orbFollowsTheme,
      reducedMotionOverride,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/**
 * Save appearance settings to persistent storage.
 */
export function saveAppearance(settings: AppearanceSettings, storage?: Storage): boolean {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return false;
    s.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve effective mode given explicit setting and system preference.
 */
export function resolveEffectiveMode(mode: ThemeMode, systemIsDark = true): "light" | "dark" {
  if (mode === "system") {
    return systemIsDark ? "dark" : "light";
  }
  return mode;
}

/**
 * Apply theme and mode to document element, color-scheme, and theme-color meta tag.
 */
export function applyThemeToDom(
  theme: ThemeId,
  mode: ThemeMode,
  rootElement?: HTMLElement,
): "light" | "dark" {
  if (typeof window === "undefined" && !rootElement) return "dark";

  const systemDark =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true;

  const effectiveMode = resolveEffectiveMode(mode, systemDark);
  const el = rootElement ?? (typeof document !== "undefined" ? document.documentElement : null);

  if (el) {
    el.setAttribute("data-theme", theme);
    el.setAttribute("data-mode", effectiveMode);
    el.style.colorScheme = effectiveMode;
  }

  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = THEME_PREVIEWS[theme]?.[effectiveMode]?.bg ?? "#070605";
      meta.setAttribute("content", bg);
    }
  }

  return effectiveMode;
}

/**
 * Static color preview swatches for settings UI.
 */
export const THEME_PREVIEWS: Record<
  ThemeId,
  {
    dark: { bg: string; text: string; accent: string; surface: string };
    light: { bg: string; text: string; accent: string; surface: string };
  }
> = {
  ember: {
    dark: { bg: "#070605", text: "#f4efe6", accent: "#d4653a", surface: "#140c09" },
    light: { bg: "#faf6f0", text: "#211813", accent: "#c25227", surface: "#f0e8dc" },
  },
  catppuccin: {
    dark: { bg: "#1e1e2e", text: "#cdd6f4", accent: "#cba6f7", surface: "#181825" },
    light: { bg: "#eff1f5", text: "#4c4f69", accent: "#8839ef", surface: "#e6e9ef" },
  },
  dracula: {
    dark: { bg: "#282a36", text: "#f8f8f2", accent: "#bd93f9", surface: "#21222c" },
    light: { bg: "#f8f8f2", text: "#282a36", accent: "#6e3ab8", surface: "#eae8e1" },
  },
  github: {
    dark: { bg: "#0d1117", text: "#f0f6fc", accent: "#58a6ff", surface: "#161b22" },
    light: { bg: "#ffffff", text: "#1f2328", accent: "#0969da", surface: "#f6f8fa" },
  },
  solarized: {
    dark: { bg: "#002b36", text: "#839496", accent: "#268bd2", surface: "#073642" },
    light: { bg: "#fdf6e3", text: "#073642", accent: "#268bd2", surface: "#eee8d5" },
  },
  gruvbox: {
    dark: { bg: "#282828", text: "#ebdbb2", accent: "#fe8019", surface: "#1d2021" },
    light: { bg: "#fbf1c7", text: "#282828", accent: "#af3a03", surface: "#f2e5bc" },
  },
  "tokyo-night": {
    dark: { bg: "#1a1b26", text: "#c0caf5", accent: "#7aa2f7", surface: "#16161e" },
    light: { bg: "#e1e2e7", text: "#3760bf", accent: "#2e7de9", surface: "#d5d6db" },
  },
  nord: {
    dark: { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0", surface: "#242933" },
    light: { bg: "#eceff4", text: "#2e3440", accent: "#5e81ac", surface: "#e5e9f0" },
  },
};

/**
 * Computes WCAG relative luminance for an sRGB hex color.
 */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "").trim();
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes WCAG contrast ratio between two colors (range: 1:1 to 21:1).
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
