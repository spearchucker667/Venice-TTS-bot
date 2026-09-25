import test from "node:test";
import assert from "node:assert/strict";
import {
  collectDiagnostics,
  formatDiagnosticsForClipboard,
  type DiagnosticsReport,
} from "./diagnostics.ts";
import { DEFAULT_PERSONA, type Persona } from "./state.ts";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "./theme.ts";

test("DIAGNOSTICS: collectDiagnostics generates valid report in SSR/Node environment", () => {
  const appearance: AppearanceSettings = {
    ...DEFAULT_APPEARANCE,
    theme: "catppuccin",
    mode: "dark",
    orbShape: "triangle",
  };

  const persona: Persona = {
    ...DEFAULT_PERSONA,
    textModel: "qwen/qwen-2.5-72b",
    ttsModel: "tts-v1",
    voice: "Dora",
    thinking: "live",
    tools: true,
  };

  const fiveMinutesAgo = Date.now() - 300_000;
  const report = collectDiagnostics(appearance, persona, fiveMinutesAgo);

  assert.ok(report.timestamp.length > 0);
  assert.equal(report.appVersion, "1.0.0");
  assert.equal(report.browser.userAgent, "SSR");
  assert.equal(report.state.theme, "catppuccin");
  assert.equal(report.state.mode, "dark");
  assert.equal(report.state.orbShape, "triangle");
  assert.equal(report.state.textModel, "qwen/qwen-2.5-72b");
  assert.equal(report.state.toolsEnabled, true);
  assert.ok(
    report.state.catalogAgeSeconds !== undefined &&
      report.state.catalogAgeSeconds >= 299 &&
      report.state.catalogAgeSeconds <= 305,
    `catalogAgeSeconds should be around 300, got ${report.state.catalogAgeSeconds}`,
  );
});

test("DIAGNOSTICS: formatDiagnosticsForClipboard formats clean markdown and guarantees redactions", () => {
  const sampleReport: DiagnosticsReport = {
    timestamp: "2026-09-25T10:00:00.000Z",
    appVersion: "1.0.0",
    browser: {
      userAgent: "Mozilla/5.0 Chrome/133.0.0.0",
      language: "en-US",
      cookieEnabled: true,
      online: true,
      screenResolution: "1920x1080",
    },
    capabilities: {
      webgl2: true,
      webglVendorRenderer: "Apple M3 Pro",
      mediaRecorder: true,
      audioContext: "supported",
      indexedDb: true,
      localStorage: true,
    },
    state: {
      theme: "tokyo-night",
      mode: "dark",
      orbShape: "hexagon",
      textModel: "meta-llama/llama-3.3-70b-instruct",
      ttsModel: "tts-v1",
      sttModel: "whisper-large-v3",
      voice: "Nicole",
      promptMode: "blend",
      thinkingMode: "stripped",
      webSearch: "auto",
      toolsEnabled: true,
      speakEnabled: true,
      catalogAgeSeconds: 120,
    },
  };

  const md = formatDiagnosticsForClipboard(sampleReport);

  assert.ok(md.includes("# Ember Diagnostics Report"));
  assert.ok(md.includes("Timestamp: 2026-09-25T10:00:00.000Z"));
  assert.ok(md.includes("Theme: tokyo-night (dark)"));
  assert.ok(md.includes("Orb Shape: hexagon"));
  assert.ok(md.includes("Apple M3 Pro"));
  assert.ok(
    md.includes(
      "Notice: API keys, conversation messages, prompt content, and cookies are never collected or copied.",
    ),
  );

  // Redaction checks: no secret strings, bearer tokens, or user data
  assert.equal(md.includes("apiKey"), false);
  assert.equal(md.includes("Authorization"), false);
  assert.equal(md.includes("Bearer"), false);
  assert.equal(md.includes("token="), false);
  assert.equal(md.includes("sk-"), false);
});
