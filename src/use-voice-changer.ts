import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  completeVoiceChange,
  quoteVoiceChange,
  queueVoiceChange,
  retrieveVoiceChange,
} from "@/venice";
import {
  createVoiceChangerController,
  type VoiceChangerSnapshot,
  type WithKey,
} from "./voice-changer-core";

function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// Durable job controller for the Voice Changer. The component renders the
// snapshot this hook returns; job lifetime (state machine, polling, cleanup,
// persisted job history) lives in the controller.
export function useVoiceChanger(opts: { epoch: number; withKey: WithKey }) {
  const controllerRef = useRef<VoiceChangerController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createVoiceChangerController({
      withKey: opts.withKey,
      venice: {
        quoteVoiceChange,
        queueVoiceChange,
        retrieveVoiceChange,
        completeVoiceChange,
      },
      storage: browserStorage(),
    });
  }
  const controller = controllerRef.current;

  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );

  // A new epoch (Stop / regeneration elsewhere in the app) aborts local
  // in-flight work only. Remote jobs are untouched and stay resumable.
  useEffect(() => {
    controller.abortInFlight();
  }, [opts.epoch, controller]);

  useEffect(() => {
    return () => controller.abortInFlight();
  }, [controller]);

  return { controller, snapshot: snapshot as VoiceChangerSnapshot };
}

type VoiceChangerController = ReturnType<typeof createVoiceChangerController>;
