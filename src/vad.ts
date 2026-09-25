/**
 * VAD (Voice Activity Detection) and interactive target helpers.
 * Audit IDs: VAD-001, VAD-002, VAD-003.
 */

export type VadConfig = {
  /** Start speech threshold (RMS 0..1, typically 0.03..0.15). */
  threshold: number;
  /** Minimum duration of speech before transition to "heard" (ms). Default 180. */
  minSpeechMs?: number;
  /** Silence duration after speech before stopping (ms). Default 900. */
  silenceMs?: number;
  /** Maximum recording duration before forced stop (ms). Default 20000. */
  maxSpeechMs?: number;
  /** Maximum wait for speech start before timeout (ms). Default 8000. */
  initialSilenceMs?: number;
  /** Hysteresis factor to sustain speech once started (0..1). Default 0.82. */
  hysteresis?: number;
};

export type VadState = {
  /** Whether user speech has been established (sustained above threshold). */
  heard: boolean;
  /** Current RMS level from audio engine. */
  currentRms: number;
  /** Timestamp when current speech burst started. */
  speechStartedAt: number;
  /** Timestamp of most recent sample above threshold. */
  lastLoudAt: number;
  /** Timestamp when silence began after speech was heard. */
  quietSince: number;
  /** Total elapsed time since tracking began (ms). */
  totalElapsed: number;
  /** Whether the tracker concluded speech should stop. */
  shouldStop: boolean;
  /** Reason for stopping if shouldStop is true. */
  stopReason?: "silence" | "max_duration" | "initial_timeout";
};

export type VadTracker = {
  /** Feed a sample reading at performance.now(). Returns the updated state. */
  step: (rms: number, now?: number) => VadState;
  /** Current state snapshot. */
  getState: () => VadState;
};

/**
 * VAD-001: timestamp-based voice activity detector with hysteresis.
 * Uses performance.now() elapsed time rather than assumed fixed-rate intervals.
 */
export function createVadTracker(config: VadConfig, startNow = performance.now()): VadTracker {
  const threshold = Math.max(0.005, config.threshold);
  const minSpeechMs = config.minSpeechMs ?? 180;
  const silenceMs = config.silenceMs ?? 900;
  const maxSpeechMs = config.maxSpeechMs ?? 20000;
  const initialSilenceMs = config.initialSilenceMs ?? 8000;
  const hysteresis = Math.max(0.5, Math.min(1.0, config.hysteresis ?? 0.82));
  const sustainThreshold = threshold * hysteresis;

  let heard = false;
  let speechBurstStart = 0;
  let lastLoudAt = 0;
  let quietSince = 0;
  let shouldStop = false;
  let stopReason: VadState["stopReason"];
  let currentRms = 0;
  let totalElapsed = 0;

  const step = (rms: number, now = performance.now()): VadState => {
    currentRms = rms;
    totalElapsed = Math.max(0, now - startNow);

    if (shouldStop) {
      return getState();
    }

    const effectiveThreshold = heard ? sustainThreshold : threshold;

    if (rms >= effectiveThreshold) {
      if (!speechBurstStart) {
        speechBurstStart = now;
      }
      lastLoudAt = now;
      quietSince = 0;

      if (!heard && now - speechBurstStart >= minSpeechMs) {
        heard = true;
      }
    } else {
      speechBurstStart = 0;
      if (heard && !quietSince) {
        quietSince = now;
      }
    }

    const silenceDuration = quietSince ? now - quietSince : 0;

    if (heard && silenceDuration >= silenceMs) {
      shouldStop = true;
      stopReason = "silence";
    } else if (totalElapsed >= maxSpeechMs) {
      shouldStop = true;
      stopReason = "max_duration";
    } else if (!heard && totalElapsed >= initialSilenceMs) {
      shouldStop = true;
      stopReason = "initial_timeout";
    }

    return getState();
  };

  const getState = (): VadState => ({
    heard,
    currentRms,
    speechStartedAt: speechBurstStart,
    lastLoudAt,
    quietSince,
    totalElapsed,
    shouldStop,
    stopReason,
  });

  return { step, getState };
}

/**
 * VAD-002: compute recommended VAD threshold given measured ambient noise floor.
 * Clamps within sane bounds [0.02, 0.20].
 */
export function computeRecommendedThreshold(noiseFloorRms: number): number {
  if (!Number.isFinite(noiseFloorRms) || noiseFloorRms <= 0) return 0.05;
  // Recommend ~2.4x the noise floor with a base margin
  const recommended = noiseFloorRms * 2.4 + 0.015;
  return Math.min(0.2, Math.max(0.02, Math.round(recommended * 1000) / 1000));
}

/**
 * VAD-003: centralized test for keyboard interactions.
 * Returns true if an event's target is an active text input or interactive control
 * where pressing or releasing Space should NOT toggle voice recording.
 */
export function isTypingOrInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
    closest?: (selector: string) => unknown;
  };

  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
    return true;
  }

  if (el.isContentEditable) {
    return true;
  }

  const role = el.getAttribute?.("role")?.toLowerCase();
  if (
    role === "button" ||
    role === "textbox" ||
    role === "combobox" ||
    role === "tab" ||
    role === "menuitem" ||
    role === "menuitemcheckbox" ||
    role === "menuitemradio" ||
    role === "option" ||
    role === "switch" ||
    role === "slider" ||
    role === "dialog" ||
    role === "alertdialog"
  ) {
    return true;
  }

  if (
    el.closest?.(
      "button, [role='button'], [role='tab'], [role='dialog'], [role='alertdialog'], [contenteditable='true']",
    )
  ) {
    return true;
  }

  return false;
}
