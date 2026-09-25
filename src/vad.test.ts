import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRecommendedThreshold,
  createVadTracker,
  isTypingOrInteractiveTarget,
} from "./vad.ts";

test("VAD-001: timestamps drive state transitions, not assumed tick counts", () => {
  let now = 10000;
  const tracker = createVadTracker({ threshold: 0.05 }, now);

  // Initial state: not heard
  let state = tracker.getState();
  assert.equal(state.heard, false);
  assert.equal(state.shouldStop, false);

  // Short spike under 180ms should not trigger "heard"
  now += 100; // t = 10100 (burst start)
  state = tracker.step(0.08, now);
  assert.equal(state.heard, false);

  now += 100; // t = 10200 (100ms into burst < 180ms)
  state = tracker.step(0.08, now);
  assert.equal(state.heard, false);

  // Sustained loud audio past 180ms establishes "heard"
  now += 100; // t = 10300 (200ms into burst >= 180ms)
  state = tracker.step(0.08, now);
  assert.equal(state.heard, true);

  // Audio level drops slightly into hysteresis zone (e.g. 0.045 with threshold 0.05 * 0.82 = 0.041)
  // Hysteresis sustains it without entering quiet
  now += 50;
  state = tracker.step(0.045, now);
  assert.equal(state.heard, true);
  assert.equal(state.quietSince, 0);

  // Level drops below sustain threshold -> enters silence
  now += 50;
  state = tracker.step(0.02, now);
  assert.equal(state.quietSince, now);

  // Silence for 500ms (< 900ms) should NOT stop
  now += 500;
  state = tracker.step(0.02, now);
  assert.equal(state.shouldStop, false);

  // Silence reaches 900ms -> shouldStop becomes true
  now += 400;
  state = tracker.step(0.02, now);
  assert.equal(state.shouldStop, true);
  assert.equal(state.stopReason, "silence");
});

test("VAD-001: initial silence timeout stops if no speech heard within 8s", () => {
  let now = 1000;
  const tracker = createVadTracker({ threshold: 0.05 }, now);

  now += 7900;
  let state = tracker.step(0.01, now);
  assert.equal(state.shouldStop, false);

  now += 200; // Total 8100ms
  state = tracker.step(0.01, now);
  assert.equal(state.shouldStop, true);
  assert.equal(state.stopReason, "initial_timeout");
});

test("VAD-001: maximum duration stops long speech at 20s", () => {
  let now = 1000;
  const tracker = createVadTracker({ threshold: 0.05 }, now);

  // Start speech
  now += 200;
  tracker.step(0.08, now);

  // Continuous speech until 20.1s
  now += 20000;
  const state = tracker.step(0.08, now);
  assert.equal(state.shouldStop, true);
  assert.equal(state.stopReason, "max_duration");
});

test("VAD-002: recommended threshold scales with noise floor and stays bounded", () => {
  // Quiet room (0.01 RMS)
  const quiet = computeRecommendedThreshold(0.01);
  assert.ok(quiet >= 0.02 && quiet <= 0.05);

  // Noisy room (0.06 RMS)
  const noisy = computeRecommendedThreshold(0.06);
  assert.ok(noisy > quiet);
  assert.ok(noisy <= 0.2);

  // Extremely loud room clamps at max 0.2
  const veryLoud = computeRecommendedThreshold(0.5);
  assert.equal(veryLoud, 0.2);

  // Zero / negative falls back to 0.05
  assert.equal(computeRecommendedThreshold(0), 0.05);
  assert.equal(computeRecommendedThreshold(-1), 0.05);
});

test("VAD-003: isTypingOrInteractiveTarget handles input, textarea, button, roles, contenteditable", () => {
  // Plain elements
  assert.equal(isTypingOrInteractiveTarget(null), false);
  assert.equal(isTypingOrInteractiveTarget({} as unknown as EventTarget), false);
  assert.equal(isTypingOrInteractiveTarget({ tagName: "DIV" } as unknown as EventTarget), false);

  // Form controls
  assert.equal(isTypingOrInteractiveTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
  assert.equal(
    isTypingOrInteractiveTarget({ tagName: "TEXTAREA" } as unknown as EventTarget),
    true,
  );
  assert.equal(isTypingOrInteractiveTarget({ tagName: "SELECT" } as unknown as EventTarget), true);
  assert.equal(isTypingOrInteractiveTarget({ tagName: "BUTTON" } as unknown as EventTarget), true);

  // ContentEditable
  assert.equal(
    isTypingOrInteractiveTarget({
      tagName: "DIV",
      isContentEditable: true,
    } as unknown as EventTarget),
    true,
  );

  // Interactive ARIA roles
  assert.equal(
    isTypingOrInteractiveTarget({
      tagName: "DIV",
      getAttribute: (attr: string) => (attr === "role" ? "button" : null),
    } as unknown as EventTarget),
    true,
  );
  assert.equal(
    isTypingOrInteractiveTarget({
      tagName: "DIV",
      getAttribute: (attr: string) => (attr === "role" ? "tab" : null),
    } as unknown as EventTarget),
    true,
  );
  assert.equal(
    isTypingOrInteractiveTarget({
      tagName: "DIV",
      getAttribute: (attr: string) => (attr === "role" ? "textbox" : null),
    } as unknown as EventTarget),
    true,
  );
});
