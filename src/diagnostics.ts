/**
 * System Diagnostics for Ember Support and Troubleshooting
 * Collects non-secret environmental, state, and browser diagnostics.
 * Strictly redacts all API keys, Authorization headers, cookies, prompt text, and message turns.
 */

import type { Persona } from "./state.ts";
import type { AppearanceSettings } from "./theme.ts";

export type DiagnosticsReport = {
  timestamp: string;
  appVersion: string;
  browser: {
    userAgent: string;
    language: string;
    cookieEnabled: boolean;
    online: boolean;
    screenResolution?: string;
  };
  capabilities: {
    webgl2: boolean;
    webglVendorRenderer?: string;
    mediaRecorder: boolean;
    audioContext: string;
    indexedDb: boolean;
    localStorage: boolean;
  };
  state: {
    theme: string;
    mode: string;
    orbShape: string;
    textModel: string;
    ttsModel: string;
    sttModel: string;
    voice: string;
    promptMode: string;
    thinkingMode: string;
    webSearch: string;
    toolsEnabled: boolean;
    speakEnabled: boolean;
    catalogRevision?: string;
    catalogAgeSeconds?: number;
  };
};

/**
 * Gathers environment diagnostics with strict redactions.
 */
export function collectDiagnostics(
  appearance: AppearanceSettings,
  persona: Persona,
  discoveryFetchedAt?: number,
): DiagnosticsReport {
  const isClient = typeof window !== "undefined";

  let webgl2 = false;
  let webglVendorRenderer = "unavailable";
  let mediaRecorder = false;
  let audioContextState = "unavailable";
  let indexedDbOk = false;
  let localStorageOk = false;

  if (isClient) {
    // WebGL
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      if (gl) {
        webgl2 = true;
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          if (typeof renderer === "string") webglVendorRenderer = renderer;
        }
      }
    } catch {
      // ignore
    }

    // MediaRecorder
    try {
      mediaRecorder = typeof window.MediaRecorder !== "undefined";
    } catch {
      // ignore
    }

    // AudioContext
    try {
      audioContextState = typeof window.AudioContext !== "undefined" ? "supported" : "unsupported";
    } catch {
      // ignore
    }

    // Storage
    try {
      indexedDbOk = typeof window.indexedDB !== "undefined";
    } catch {
      // ignore
    }

    try {
      localStorageOk = typeof window.localStorage !== "undefined";
    } catch {
      // ignore
    }
  }

  const catalogAgeSeconds = discoveryFetchedAt
    ? Math.max(0, Math.round((Date.now() - discoveryFetchedAt) / 1000))
    : undefined;

  return {
    timestamp: new Date().toISOString(),
    appVersion: "1.0.0",
    browser: {
      userAgent: isClient ? navigator.userAgent : "SSR",
      language: isClient ? navigator.language : "en",
      cookieEnabled: isClient ? navigator.cookieEnabled : false,
      online: isClient ? navigator.onLine : true,
      screenResolution:
        isClient && window.screen ? `${window.screen.width}x${window.screen.height}` : undefined,
    },
    capabilities: {
      webgl2,
      webglVendorRenderer,
      mediaRecorder,
      audioContext: audioContextState,
      indexedDb: indexedDbOk,
      localStorage: localStorageOk,
    },
    state: {
      theme: appearance.theme,
      mode: appearance.mode,
      orbShape: appearance.orbShape,
      textModel: persona.textModel,
      ttsModel: persona.ttsModel,
      sttModel: persona.sttModel,
      voice: persona.voice,
      promptMode: persona.promptMode,
      thinkingMode: persona.thinking,
      webSearch: persona.webSearch,
      toolsEnabled: persona.tools,
      speakEnabled: persona.speak,
      catalogAgeSeconds,
    },
  };
}

/**
 * Formats report as clean Markdown text suitable for clipboard copy.
 * Asserts redactions explicitly.
 */
export function formatDiagnosticsForClipboard(report: DiagnosticsReport): string {
  return [
    "# Ember Diagnostics Report",
    `Timestamp: ${report.timestamp}`,
    `App Version: ${report.appVersion}`,
    "",
    "## Browser & Platform",
    `- User Agent: ${report.browser.userAgent}`,
    `- Language: ${report.browser.language}`,
    `- Online: ${report.browser.online ? "yes" : "no"}`,
    report.browser.screenResolution ? `- Screen: ${report.browser.screenResolution}` : null,
    "",
    "## Engine Capabilities",
    `- WebGL2: ${report.capabilities.webgl2 ? "yes" : "no"} (${report.capabilities.webglVendorRenderer})`,
    `- MediaRecorder: ${report.capabilities.mediaRecorder ? "yes" : "no"}`,
    `- AudioContext: ${report.capabilities.audioContext}`,
    `- IndexedDB: ${report.capabilities.indexedDb ? "available" : "unavailable"}`,
    `- LocalStorage: ${report.capabilities.localStorage ? "available" : "unavailable"}`,
    "",
    "## Active State (Secrets Redacted)",
    `- Theme: ${report.state.theme} (${report.state.mode})`,
    `- Orb Shape: ${report.state.orbShape}`,
    `- Text Model: ${report.state.textModel}`,
    `- TTS Model: ${report.state.ttsModel} / Voice: ${report.state.voice}`,
    `- STT Model: ${report.state.sttModel}`,
    `- Prompt Mode: ${report.state.promptMode}`,
    `- Thinking: ${report.state.thinkingMode}`,
    `- Web Search: ${report.state.webSearch}`,
    `- Tools: ${report.state.toolsEnabled ? "enabled" : "disabled"}`,
    report.state.catalogAgeSeconds !== undefined
      ? `- Catalog Age: ${report.state.catalogAgeSeconds}s`
      : null,
    "",
    "> Notice: API keys, conversation messages, prompt content, and cookies are never collected or copied.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}
