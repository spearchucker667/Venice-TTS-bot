import { useCallback, useEffect, useRef, useState } from "react";
import { bindLevel, createAudio, type AudioEngine } from "@/audio";
import {
  blankChat,
  branchChat,
  clearChats,
  deleteChat,
  listChats,
  saveChat,
  snapshotFromPersona,
  sortChats,
  titleFromTurns,
  type ChatRecord,
} from "@/chats";
import { buildChatExport, parseChatImport, type ChatImportResult } from "@/chat-export";
import { localCommand, presentText, readySentences, slashCommand, spokenText } from "@/speech";
import {
  contextWindow,
  keyTail,
  loadFavs,
  loadKey,
  loadKeyMode,
  loadMessages,
  loadPersona,
  loadRecentCharacters,
  saveFavs,
  saveKey,
  saveMessages,
  savePersona,
  saveRecentCharacters,
  visual,
  VOICE_FALLBACK,
  type Citation,
  type KeyMode,
  type Mood,
  type Persona,
  type ToolCall,
  type Turn,
} from "@/state";
import {
  directoryPrefix,
  grantSessionAccess,
  loadIntegrations,
  normalizeIntegration,
  purgeLegacyHosts,
  saveIntegrations,
  type HttpIntegration,
  type IntegrationInput,
} from "@/tools/integrations";
import {
  balanceFrom,
  chatBody,
  discoverModels,
  finishedTools,
  loadCatalog,
  mergeToolDeltas,
  modelSupportsTools,
  modelVoices,
  runTool,
  saveCatalog,
  searchCharacters,
  streamChat,
  synthesize,
  synthesizeStream,
  transcribe,
  VeniceError,
  type Balance,
  type Discovery,
  type HttpConfirm,
  type VeniceCharacter,
} from "@/venice";
import { createVadTracker, isTypingOrInteractiveTarget } from "./vad.ts";

type PendingHost = {
  host: string;
  origin: string;
  method: string;
  path: string;
  mutating: boolean;
  bodyPreview: string;
  /** Reads may be scoped to this browser session (never persisted). */
  canSession: boolean;
  /** Reads over https may be turned into a durable scoped integration. */
  canIntegrate: boolean;
  allowOnce: () => void;
  allowSession: () => void;
  allowIntegrate: () => void;
  deny: () => void;
};

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function toolRejection(err: unknown): boolean {
  return err instanceof VeniceError && err.status === 400 && /tool|function/i.test(err.message);
}

export function voicesFor(model: string, discovery: Discovery | null): string[] {
  const found = discovery?.voices[model];
  if (found?.length) return found;
  return VOICE_FALLBACK[model] ?? [];
}

export function useEmber() {
  const [hydrated, setHydrated] = useState(false);
  const [persona, setPersona] = useState<Persona>(loadPersona);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [liveThought, setLiveThought] = useState("");
  const [status, setStatus] = useState("Here");
  const [error, setError] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [tail, setTail] = useState("");
  const [recording, setRecording] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [balance, setBalance] = useState<Balance>({ usd: null, diem: null });
  const [pending, setPending] = useState<PendingHost | null>(null);
  const [busy, setBusy] = useState(false);
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [incognito, setIncognitoState] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleteToast, setDeleteToast] = useState<{ id: string; title: string } | null>(null);
  const [integrations, setIntegrations] = useState<HttpIntegration[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [recentCharacters, setRecentCharacters] = useState<string[]>([]);
  const [keyMode, setKeyMode] = useState<KeyMode>("remember");
  const [epoch, setEpoch] = useState(0);
  const metaRef = useRef<ChatRecord | null>(null);
  const chatsRef = useRef<ChatRecord[]>([]);
  const incognitoRef = useRef(false);
  const trashRef = useRef<{ chat: ChatRecord; timer: number } | null>(null);

  const personaRef = useRef(persona);
  const turnsRef = useRef(turns);
  const discoveryRef = useRef(discovery);
  const handsRef = useRef(handsFree);
  const integrationsRef = useRef<HttpIntegration[]>([]);
  const audioRef = useRef<AudioEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listenGen = useRef(0);
  const runRef = useRef(0);
  const vadRef = useRef(0);
  const recordingRef = useRef(false);
  const keyRef = useRef("");
  const beginListenRef = useRef<(hands: boolean) => void>(() => {});

  useEffect(() => {
    personaRef.current = persona;
  }, [persona]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    discoveryRef.current = discovery;
  }, [discovery]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  useEffect(() => {
    handsRef.current = handsFree;
  }, [handsFree]);

  const setMood = useCallback((mood: Mood, line: string) => {
    visual.mood = mood;
    setStatus(line);
  }, []);

  const noteResponse = useCallback((res: Response) => {
    const next = balanceFrom(res.headers);
    if (next.usd || next.diem) setBalance(next);
  }, []);

  const refreshModels = useCallback(async (key: string) => {
    try {
      const found = await discoverModels(key);
      const voiceId = personaRef.current.ttsModel;
      const voices = await modelVoices(key, voiceId).catch(() => [] as string[]);
      if (voices.length) found.voices[voiceId] = voices;
      saveCatalog(found);
      setDiscovery(found);
    } catch (err) {
      const message = err instanceof VeniceError ? err.message : "Catalog refresh failed.";
      setError(message);
    }
  }, []);

  /** CHAT-011: incognito mode pauses every history persistence write. */
  const persistChat = useCallback((chat: ChatRecord) => {
    if (incognitoRef.current) return;
    void saveChat(chat).catch(() => undefined);
  }, []);

  const setIncognito = useCallback((value: boolean) => {
    incognitoRef.current = value;
    setIncognitoState(value);
    setNotice(
      value
        ? "Incognito is on. Nothing new is written to chat history; turns stay in memory."
        : "Incognito is off. Chats save to this browser again.",
    );
  }, []);

  const catalogRevision = () => {
    const fetchedAt = discoveryRef.current?.fetchedAt;
    return fetchedAt ? String(fetchedAt) : undefined;
  };

  const remember = useCallback(
    (turns: Turn[]) => {
      if (!incognitoRef.current) saveMessages(turns);
      const current = metaRef.current;
      if (!current) return;
      const next: ChatRecord = {
        ...current,
        turns,
        title: current.title === "New chat" ? titleFromTurns(turns) : current.title,
        updatedAt: Date.now(),
      };
      metaRef.current = next;
      setChats((prev) => {
        const rows = prev.some((row) => row.id === next.id)
          ? prev.map((row) => (row.id === next.id ? next : row))
          : [next, ...prev];
        return sortChats(rows);
      });
      persistChat(next);
    },
    [persistChat],
  );

  useEffect(() => {
    const key = loadKey();
    keyRef.current = key;
    const loaded = loadIntegrations();
    integrationsRef.current = loaded;
    purgeLegacyHosts();
    setHasKey(Boolean(key));
    setTail(keyTail(key));
    setKeyMode(loadKeyMode());
    setPersona(loadPersona());
    setIntegrations(loaded);
    setFavs(loadFavs());
    setRecentCharacters(loadRecentCharacters());
    const cached = loadCatalog();
    if (cached) setDiscovery(cached);
    setHydrated(true);
    void listChats()
      .then(async (rows) => {
        let next = rows;
        if (!next.length) {
          const legacy = loadMessages();
          const chat: ChatRecord = blankChat();
          chat.turns = legacy;
          chat.title = titleFromTurns(legacy);
          await saveChat(chat).catch(() => undefined);
          next = [chat];
        }
        const current = next[0];
        if (!current) return;
        metaRef.current = current;
        turnsRef.current = current.turns;
        setChats(next);
        setTurns(current.turns);
      })
      .catch(() => {
        const legacy = loadMessages();
        setTurns(legacy);
        turnsRef.current = legacy;
      });
    const audio = createAudio();
    audioRef.current = audio;
    const unbind = bindLevel(() => audio.level());
    if (key) void refreshModels(key);
    return () => {
      unbind();
      window.clearInterval(vadRef.current);
      abortRef.current?.abort();
      audio.dispose();
      audioRef.current = null;
    };
  }, [refreshModels]);

  const stopAll = useCallback(() => {
    runRef.current += 1;
    listenGen.current += 1;
    abortRef.current?.abort();
    window.clearInterval(vadRef.current);
    const audio = audioRef.current;
    void audio?.cancelMic();
    audio?.stopPlayback();
    recordingRef.current = false;
    setRecording(false);
    setPartial("");
    setLiveThought("");
    setBusy(false);
    setPending(null);
    setEpoch((value) => value + 1);
    setMood("idle", "Here");
  }, [setMood]);

  const clearChat = useCallback(() => {
    stopAll();
    const current = metaRef.current;
    turnsRef.current = [];
    setTurns([]);
    setError("");
    if (!current) {
      saveMessages([]);
      setMood("idle", "Cleared");
      return;
    }
    const auto = current.title === titleFromTurns(current.turns);
    const next: ChatRecord = {
      ...current,
      turns: [],
      title: auto ? "New chat" : current.title,
      updatedAt: Date.now(),
    };
    metaRef.current = next;
    setChats((prev) => sortChats(prev.map((row) => (row.id === next.id ? next : row))));
    saveMessages([]);
    persistChat(next);
    setMood("idle", "Cleared");
  }, [persistChat, setMood, stopAll]);

  const patchPersona = useCallback((partialPersona: Partial<Persona>) => {
    setPersona((prev) => {
      const next = { ...prev, ...partialPersona };
      if (partialPersona.ttsModel && partialPersona.ttsModel !== prev.ttsModel) {
        const list = voicesFor(partialPersona.ttsModel, discoveryRef.current);
        if (list.length && !list.includes(next.voice)) next.voice = list[0] ?? next.voice;
      }
      savePersona(next);
      personaRef.current = next;
      return next;
    });
  }, []);

  const commitKey = useCallback(
    (raw: string, mode?: KeyMode) => {
      const key = raw.trim();
      const nextMode = mode ?? loadKeyMode();
      saveKey(key, nextMode);
      keyRef.current = key;
      setHasKey(Boolean(key));
      setTail(keyTail(key));
      setKeyMode(nextMode);
      setError("");
      if (key) void refreshModels(key);
      else setDiscovery(null);
    },
    [refreshModels],
  );

  const forgetKey = useCallback(() => {
    commitKey("");
  }, [commitKey]);

  const addIntegration = useCallback((input: IntegrationInput): { ok: boolean; error?: string } => {
    const normalized = normalizeIntegration(input);
    if ("error" in normalized) return { ok: false, error: normalized.error };
    const integration = normalized.integration;
    const next = [
      ...integrationsRef.current.filter(
        (item) =>
          !(item.origin === integration.origin && item.pathPrefix === integration.pathPrefix),
      ),
      integration,
    ].slice(-40);
    integrationsRef.current = next;
    saveIntegrations(next);
    setIntegrations(next);
    return { ok: true };
  }, []);

  const confirmHttp = useCallback(
    (req: HttpConfirm, signal: AbortSignal) => {
      return new Promise<boolean>((resolve, reject) => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          setPending(null);
          resolve(ok);
        };
        const onAbort = () => {
          setPending(null);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        const readOnly = !req.mutating;
        const canIntegrate = readOnly && req.origin.startsWith("https:");
        setPending({
          host: req.host,
          origin: req.origin,
          method: req.method,
          path: req.path,
          mutating: req.mutating,
          bodyPreview: req.bodyPreview,
          canSession: readOnly,
          canIntegrate,
          allowOnce: () => finish(true),
          allowSession: () => {
            if (readOnly) {
              grantSessionAccess({
                origin: req.origin,
                pathPrefix: directoryPrefix(req.pathname),
                methods: [req.method],
              });
            }
            finish(true);
          },
          allowIntegrate: () => {
            if (canIntegrate) {
              addIntegration({
                origin: req.origin,
                pathPrefix: directoryPrefix(req.pathname),
                methods: [req.method],
              });
            }
            finish(true);
          },
          deny: () => finish(false),
        });
      });
    },
    [addIntegration],
  );

  const playResponse = useCallback(async (res: Response, signal: AbortSignal) => {
    const audio = audioRef.current;
    if (!audio) return;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("json"))
      throw new VeniceError(res.status || 502, "Speech did not come back as audio.");
    if (type.includes("mpeg") || type.includes("mp3") || type.includes("wav")) {
      await audio.playMp3(await res.arrayBuffer());
      return;
    }
    await audio.playPcmStream(res.body, 24000, signal);
  }, []);

  const speakText = useCallback(
    async (text: string, signal: AbortSignal, still: () => boolean) => {
      const personaNow = personaRef.current;
      if (!personaNow.speak) return;
      const clean = spokenText(text);
      const { ready, rest } = readySentences(clean);
      const pieces = [...ready, ...(rest.trim() ? [rest.trim()] : [])];
      if (!pieces.length || !still()) return;
      const audio = audioRef.current;
      if (!audio) return;
      const prepare = async (piece: string) => {
        try {
          return await synthesizeStream(keyRef.current, piece, personaNow, signal, noteResponse);
        } catch (err) {
          if (isAbort(err) || signal.aborted) throw err;
          const buf = await synthesize(keyRef.current, piece, personaNow, signal, noteResponse);
          return buf;
        }
      };
      let upcoming: Promise<Response | ArrayBuffer> = prepare(pieces[0] ?? "");
      for (let i = 0; i < pieces.length; i++) {
        const readyAudio = await upcoming;
        if (!still()) return;
        const follow = pieces[i + 1];
        if (follow) upcoming = prepare(follow);
        setMood("speak", "Speaking");
        if (readyAudio instanceof ArrayBuffer) await audio.playMp3(readyAudio);
        else await playResponse(readyAudio, signal);
        if (!still()) return;
      }
    },
    [noteResponse, playResponse, setMood],
  );

  const runTurn = useCallback(
    async (text: string, source: "voice" | "text" = "text") => {
      const said = text.trim();
      if (!said) return;
      const command = source === "voice" ? localCommand(said) : slashCommand(said);
      if (command === "stop") {
        stopAll();
        setMood("idle", "Quiet");
        return;
      }
      if (command === "clear") {
        clearChat();
        return;
      }
      if (command === "settings") {
        setSettingsOpen(true);
        setMood("idle", "Settings");
        return;
      }
      if (!keyRef.current) {
        setSettingsOpen(true);
        setError("Add a Venice API key to talk.");
        return;
      }
      const traits = discoveryRef.current?.traits ?? {};
      if (!chatBody(personaRef.current, [], traits, false).model) {
        setSettingsOpen(true);
        setError("No text model yet. Refresh the Venice catalog in settings.");
        setMood("error", "No model");
        return;
      }

      runRef.current += 1;
      const run = runRef.current;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const still = () => run === runRef.current && !ac.signal.aborted;
      audioRef.current?.stopPlayback();
      setError("");
      setBusy(true);
      setPartial("");
      setLiveThought("");

      let working: Turn[] = [...turnsRef.current, { role: "user", content: said }];
      turnsRef.current = working;
      setTurns(working);
      remember(working);
      setMood("think", "Thinking");

      let speechError = false;
      let droppedSpeech = false;
      let speechGen = 0;
      let playChain = Promise.resolve();
      const personaSpeech = personaRef.current;
      const enqueueSpeech = (sentence: string) => {
        if (!personaSpeech.speak || droppedSpeech || !sentence.trim()) return;
        const gen = speechGen;
        const prepared = (async () => {
          try {
            return await synthesizeStream(
              keyRef.current,
              sentence,
              personaSpeech,
              ac.signal,
              noteResponse,
            );
          } catch (err) {
            if (isAbort(err) || ac.signal.aborted) throw err;
            return synthesize(keyRef.current, sentence, personaSpeech, ac.signal, noteResponse);
          }
        })();
        playChain = playChain
          .then(async () => {
            if (gen !== speechGen || speechError || !still()) return;
            const readyAudio = await prepared;
            if (gen !== speechGen || !still()) return;
            setMood("speak", "Speaking");
            if (readyAudio instanceof ArrayBuffer) await audioRef.current?.playMp3(readyAudio);
            else await playResponse(readyAudio, ac.signal);
          })
          .catch((err: unknown) => {
            if (gen !== speechGen || isAbort(err) || !still()) return;
            speechError = true;
            audioRef.current?.stopPlayback();
          });
      };
      const pumpSpeech = (raw: string, sent: number, flush: boolean) => {
        if (droppedSpeech) return sent;
        const clean = spokenText(raw);
        const { ready, rest } = readySentences(clean);
        for (const piece of ready.slice(sent)) enqueueSpeech(piece);
        if (flush && rest.trim()) enqueueSpeech(rest.trim());
        return ready.length;
      };

      try {
        let allowTools =
          personaSpeech.tools && modelSupportsTools(personaSpeech.textModel, discoveryRef.current);
        for (let round = 0; round < 4; round++) {
          if (!still()) return;
          const useTools = allowTools && round < 3;
          const personaNow = personaRef.current;
          speechGen += 1;
          playChain = Promise.resolve();
          droppedSpeech = false;
          let sent = 0;
          const body = chatBody(
            personaNow,
            contextWindow(working),
            discoveryRef.current?.traits ?? {},
            useTools,
          );
          if (!body.model)
            throw new VeniceError(400, "No text model yet. Refresh the Venice catalog.");
          let content = "";
          let thinking = "";
          const citations: Citation[] = [];
          const deltas = new Map<number, ToolCall>();
          try {
            for await (const ev of streamChat(keyRef.current, body, ac.signal, noteResponse)) {
              if (!still()) return;
              if (ev.type === "content") {
                content += ev.text;
                const shown = presentText(content);
                setPartial(shown.speech);
                if (shown.thought) setLiveThought(shown.thought);
                if (!droppedSpeech) sent = pumpSpeech(shown.speech, sent, false);
              } else if (ev.type === "reasoning") {
                thinking += ev.text;
                if (personaNow.thinking === "live") setLiveThought(thinking);
              } else if (ev.type === "tool_delta") {
                mergeToolDeltas(deltas, ev);
                if (!droppedSpeech) {
                  droppedSpeech = true;
                  speechGen += 1;
                  audioRef.current?.stopPlayback();
                }
              } else if (ev.type === "citation") {
                citations.push({ title: ev.title, url: ev.url });
              }
            }
          } catch (err) {
            if (useTools && toolRejection(err)) {
              allowTools = false;
              continue;
            }
            throw err;
          }
          const presented = presentText(content);
          const thought = [thinking.trim(), presented.thought].filter(Boolean).join("\n\n");
          const calls = useTools ? finishedTools(deltas) : [];
          const assistant: Turn = {
            role: "assistant",
            content: presented.speech,
            thinking: personaNow.thinking === "live" && thought ? thought : undefined,
            tool_calls: calls.length ? calls : undefined,
            citations: citations.length ? citations : undefined,
          };
          working = [...working, assistant];
          turnsRef.current = working;
          setTurns(working);
          setPartial("");
          remember(working);
          if (!calls.length) {
            if (personaSpeech.speak) {
              if (droppedSpeech) {
                droppedSpeech = false;
                speechGen += 1;
                sent = 0;
                playChain = Promise.resolve();
                audioRef.current?.stopPlayback();
              }
              pumpSpeech(presented.speech, sent, true);
              await playChain;
              if (speechError && still())
                setError("Speech playback failed. The answer is still in the chat.");
            }
            break;
          }
          for (const call of calls) {
            if (!still()) return;
            const label =
              call.name === "venice_web_search"
                ? "Searching"
                : call.name === "venice_scrape"
                  ? "Reading"
                  : "Calling an API";
            setMood("tool", label);
            const result = await runTool(call, {
              key: keyRef.current,
              signal: ac.signal,
              confirmHttp: (req) => confirmHttp(req, ac.signal),
              httpIntegrations: integrationsRef.current,
            });
            if (!still()) return;
            working = [
              ...working,
              { role: "tool", content: result, tool_call_id: call.id, name: call.name },
            ];
            turnsRef.current = working;
            setTurns(working);
            remember(working);
            setMood("think", "Thinking");
          }
        }
        setLiveThought("");
        if (!still()) return;
        setMood("idle", handsRef.current ? "Your turn" : "Here");
        setBusy(false);
        if (handsRef.current) beginListenRef.current(true);
      } catch (err) {
        if (isAbort(err) || !still()) return;
        const message =
          err instanceof VeniceError ? err.message : "Something went wrong before Venice answered.";
        if (err instanceof VeniceError && (err.usd || err.diem)) {
          setBalance({ usd: err.usd, diem: err.diem });
        }
        setError(message);
        setMood("error", "Paused");
        setBusy(false);
        setPartial("");
      }
    },
    [clearChat, confirmHttp, noteResponse, playResponse, remember, setMood, stopAll],
  );

  const finishRecording = useCallback(
    async (blob: Blob | null) => {
      recordingRef.current = false;
      setRecording(false);
      window.clearInterval(vadRef.current);
      if (!blob || blob.size < 800) {
        if (visual.mood === "listen") setMood("idle", "Here");
        return;
      }
      if (!keyRef.current) {
        setError("Add a Venice API key to talk.");
        setSettingsOpen(true);
        return;
      }
      setMood("think", "Hearing you");
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const text = await transcribe(
          keyRef.current,
          blob,
          personaRef.current.sttModel,
          ac.signal,
          noteResponse,
        );
        if (!text) {
          setMood("idle", "Didn't catch that");
          return;
        }
        await runTurn(text, "voice");
      } catch (err) {
        if (isAbort(err)) return;
        const message = err instanceof VeniceError ? err.message : "Could not transcribe that.";
        setError(message);
        setMood("error", "Paused");
      }
    },
    [noteResponse, runTurn, setMood],
  );

  const beginListen = useCallback(
    (hands: boolean) => {
      const audio = audioRef.current;
      if (!audio || recordingRef.current) return;
      if (!keyRef.current) {
        setSettingsOpen(true);
        setError("Add a Venice API key to talk.");
        return;
      }
      audio.stopPlayback();
      const gen = ++listenGen.current;
      runRef.current += 1;
      abortRef.current?.abort();
      setBusy(false);
      setPartial("");
      setError("");
      void audio
        .startMic()
        .then(() => {
          if (gen !== listenGen.current) {
            void audio.cancelMic();
            return;
          }
          recordingRef.current = true;
          setRecording(true);
          setMood("listen", hands ? "Your turn" : "Hearing you");
          if (!hands) return;
          const tracker = createVadTracker({
            threshold: personaRef.current.vad,
            minSpeechMs: 180,
            silenceMs: 900,
            maxSpeechMs: 20000,
            initialSilenceMs: 8000,
          });
          window.clearInterval(vadRef.current);
          vadRef.current = window.setInterval(() => {
            if (!recordingRef.current) {
              window.clearInterval(vadRef.current);
              return;
            }
            const state = tracker.step(audio.level());
            if (state.shouldStop) {
              window.clearInterval(vadRef.current);
              void audio.stopMic().then((blob) => finishRecording(blob));
            }
          }, 40);
        })
        .catch(() => {
          setError("Microphone permission is blocked.");
          setMood("error", "No microphone");
        });
    },
    [finishRecording, setMood],
  );

  beginListenRef.current = beginListen;

  const toggleMic = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (recordingRef.current) {
      window.clearInterval(vadRef.current);
      void audio.stopMic().then((blob) => finishRecording(blob));
      return;
    }
    beginListen(handsRef.current);
  }, [beginListen, finishRecording]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingOrInteractiveTarget(event.target)) return;
      event.preventDefault();
      if (!recordingRef.current) beginListen(false);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isTypingOrInteractiveTarget(event.target)) return;
      listenGen.current += 1;
      event.preventDefault();
      const audio = audioRef.current;
      window.clearInterval(vadRef.current);
      if (!recordingRef.current) {
        void audio?.cancelMic();
        return;
      }
      void audio?.stopMic().then((blob) => finishRecording(blob));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [beginListen, finishRecording]);

  return {
    hydrated,
    persona,
    patchPersona,
    turns,
    partial,
    liveThought,
    status,
    error,
    hasKey,
    tail,
    recording,
    handsFree,
    setHandsFree,
    settingsOpen,
    setSettingsOpen,
    discovery,
    balance,
    pending,
    busy,
    commitKey,
    forgetKey,
    send: runTurn,
    toggleMic,
    stopAll,
    clearChat,
    loadVoices: async (model: string) => {
      if (!keyRef.current) return;
      const voices = await modelVoices(keyRef.current, model).catch(() => [] as string[]);
      if (!voices.length) return;
      setDiscovery((prev) =>
        prev ? { ...prev, voices: { ...prev.voices, [model]: voices } } : prev,
      );
    },
    chats,
    incognito,
    setIncognito,
    notice,
    clearNotice: () => setNotice(""),
    deleteToast,
    integrations,
    favs,
    recentCharacters,
    keyMode,
    epoch,
    activeChatId: metaRef.current?.id ?? "",
    refreshCatalog: () => {
      if (keyRef.current) void refreshModels(keyRef.current);
    },
    setKeyMode: (mode: KeyMode) => {
      saveKey(keyRef.current, mode);
      setKeyMode(mode);
    },
    findCharacters: async (query: string): Promise<VeniceCharacter[]> => {
      if (!keyRef.current) return [];
      return searchCharacters(keyRef.current, query);
    },
    chooseCharacter: (slug: string) => {
      patchPersona({ characterSlug: slug });
      if (!slug) return;
      setRecentCharacters((prev) => {
        const next = [slug, ...prev.filter((item) => item !== slug)].slice(0, 8);
        saveRecentCharacters(next);
        return next;
      });
    },
    toggleFav: (slug: string) => {
      setFavs((prev) => {
        const next = prev.includes(slug)
          ? prev.filter((item) => item !== slug)
          : [slug, ...prev].slice(0, 24);
        saveFavs(next);
        return next;
      });
    },
    addIntegration,
    removeIntegration: (id: string) => {
      const next = integrationsRef.current.filter((item) => item.id !== id);
      integrationsRef.current = next;
      saveIntegrations(next);
      setIntegrations(next);
    },
    startChat: () => {
      if (metaRef.current && metaRef.current.turns.length === 0) {
        stopAll();
        setError("");
        return;
      }
      stopAll();
      const chat = blankChat(snapshotFromPersona(personaRef.current, catalogRevision()));
      metaRef.current = chat;
      turnsRef.current = [];
      setTurns([]);
      saveMessages([]);
      setChats((prev) => sortChats([chat, ...prev]));
      persistChat(chat);
      setError("");
    },
    openChat: (id: string) => {
      const row = chatsRef.current.find((chat) => chat.id === id);
      if (!row || row.id === metaRef.current?.id) return;
      stopAll();
      metaRef.current = row;
      turnsRef.current = row.turns;
      setTurns(row.turns);
      saveMessages(row.turns);
      if (row.settings) {
        const snapshot = row.settings;
        patchPersona({
          textModel: snapshot.textModel,
          systemPrompt: snapshot.systemPrompt,
          promptMode: snapshot.promptMode,
          characterSlug: snapshot.characterSlug,
          temperature: snapshot.temperature,
          topP: snapshot.topP,
          maxTokens: snapshot.maxTokens,
          webSearch: snapshot.webSearch,
          tools: snapshot.tools,
        });
      }
      setError("");
    },
    branchFrom: (turnIndex: number) => {
      const current = metaRef.current;
      if (!current || turnIndex < 0 || turnIndex >= turnsRef.current.length) return;
      stopAll();
      const source: ChatRecord = {
        ...current,
        turns: turnsRef.current,
        settings: current.settings || snapshotFromPersona(personaRef.current, catalogRevision()),
      };
      const branched = branchChat(source, turnIndex);
      metaRef.current = branched;
      turnsRef.current = branched.turns;
      setTurns(branched.turns);
      saveMessages(branched.turns);
      setChats((prev) => sortChats([branched, ...prev]));
      persistChat(branched);
      if (branched.settings) {
        const snapshot = branched.settings;
        patchPersona({
          textModel: snapshot.textModel,
          systemPrompt: snapshot.systemPrompt,
          promptMode: snapshot.promptMode,
          characterSlug: snapshot.characterSlug,
          temperature: snapshot.temperature,
          topP: snapshot.topP,
          maxTokens: snapshot.maxTokens,
          webSearch: snapshot.webSearch,
          tools: snapshot.tools,
        });
      }
      setError("");
    },
    renameChat: (id: string, title: string) => {
      const clean = title.trim().slice(0, 48) || "New chat";
      setChats((prev) =>
        sortChats(
          prev.map((row) => {
            if (row.id !== id) return row;
            const next = { ...row, title: clean };
            if (metaRef.current?.id === id) metaRef.current = { ...metaRef.current, title: clean };
            persistChat(next);
            return next;
          }),
        ),
      );
    },
    pinChat: (id: string) => {
      setChats((prev) => {
        const next = sortChats(
          prev.map((row) => {
            if (row.id !== id) return row;
            const updated = { ...row, pinned: !row.pinned };
            if (metaRef.current?.id === id)
              metaRef.current = { ...metaRef.current, pinned: updated.pinned };
            persistChat(updated);
            return updated;
          }),
        );
        return next;
      });
    },
    removeChat: (id: string) => {
      const row = chatsRef.current.find((chat) => chat.id === id);
      if (!row) return;
      const previous = trashRef.current;
      if (previous) {
        window.clearTimeout(previous.timer);
        trashRef.current = null;
        void deleteChat(previous.chat.id).catch(() => undefined);
      }
      const remaining = chatsRef.current.filter((chat) => chat.id !== id);
      if (metaRef.current?.id === id) {
        stopAll();
        const fallback =
          remaining[0] ?? blankChat(snapshotFromPersona(personaRef.current, catalogRevision()));
        if (!remaining.length) remaining.unshift(fallback);
        metaRef.current = fallback;
        turnsRef.current = fallback.turns;
        setTurns(fallback.turns);
        saveMessages(fallback.turns);
        if (!chatsRef.current.some((chat) => chat.id === fallback.id)) persistChat(fallback);
      }
      setChats(sortChats(remaining));
      setDeleteToast({ id: row.id, title: row.title });
      const deleted = row;
      trashRef.current = {
        chat: deleted,
        timer: window.setTimeout(() => {
          trashRef.current = null;
          setDeleteToast(null);
          void deleteChat(deleted.id).catch(() => undefined);
        }, 8000),
      };
    },
    undoDelete: () => {
      const pending = trashRef.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      trashRef.current = null;
      setDeleteToast(null);
      persistChat(pending.chat);
      setChats((prev) =>
        sortChats(prev.some((row) => row.id === pending.chat.id) ? prev : [pending.chat, ...prev]),
      );
      setNotice(`Restored “${pending.chat.title}”.`);
    },
    dismissDeleteToast: () => {
      const pending = trashRef.current;
      if (pending) {
        window.clearTimeout(pending.timer);
        trashRef.current = null;
        void deleteChat(pending.chat.id).catch(() => undefined);
      }
      setDeleteToast(null);
    },
    clearAllChats: () => {
      stopAll();
      if (!incognitoRef.current) void clearChats().catch(() => undefined);
      const chat = blankChat(snapshotFromPersona(personaRef.current, catalogRevision()));
      metaRef.current = chat;
      turnsRef.current = [];
      setTurns([]);
      saveMessages([]);
      setChats([chat]);
      persistChat(chat);
    },
    exportChats: () => {
      const blob = new Blob([JSON.stringify(buildChatExport(chatsRef.current), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ember-chats.json";
      link.click();
      URL.revokeObjectURL(url);
    },
    exportChat: (id: string) => {
      const chat = chatsRef.current.find((row) => row.id === id);
      if (!chat) return;
      const blob = new Blob([JSON.stringify(buildChatExport([chat]), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const slug =
        chat.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 32) || "chat";
      link.download = `ember-chat-${slug}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    applyDefaultsToChat: (id: string) => {
      const settings = snapshotFromPersona(personaRef.current, catalogRevision());
      setChats((prev) =>
        sortChats(
          prev.map((row) => {
            if (row.id !== id) return row;
            const next = { ...row, settings };
            if (metaRef.current?.id === id) metaRef.current = next;
            persistChat(next);
            return next;
          }),
        ),
      );
      setNotice("Current defaults saved to that conversation.");
    },
    importChats: async (file: File) => {
      let result: ChatImportResult;
      try {
        const json: unknown = JSON.parse(await file.text());
        result = parseChatImport(json, new Set(chatsRef.current.map((chat) => chat.id)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "That file is not an Ember chat export.");
        return;
      }
      if (!result.chats.length) {
        setError("No chats found in that file.");
        return;
      }
      if (incognitoRef.current) {
        setChats((prev) => sortChats([...prev, ...result.chats]));
        setNotice("Incognito is on: imported chats are in memory only and were not saved.");
        return;
      }
      for (const row of result.chats) await saveChat(row).catch(() => undefined);
      const rows = await listChats().catch(() => sortChats(result.chats));
      setChats(rows);
      const current = rows[0];
      if (current) {
        metaRef.current = current;
        turnsRef.current = current.turns;
        setTurns(current.turns);
        saveMessages(current.turns);
      }
      const summary = result.summary;
      const parts = [`Imported ${summary.imported} ${summary.imported === 1 ? "chat" : "chats"}`];
      if (summary.idConflicts)
        parts.push(
          `${summary.idConflicts} duplicate ${summary.idConflicts === 1 ? "ID" : "IDs"} given new IDs`,
        );
      if (summary.archivedTransactions)
        parts.push(
          `${summary.archivedTransactions} incomplete tool ${
            summary.archivedTransactions === 1 ? "call" : "calls"
          } archived as text`,
        );
      if (summary.droppedOrphanTools)
        parts.push(
          `${summary.droppedOrphanTools} orphan tool ${
            summary.droppedOrphanTools === 1 ? "result" : "results"
          } removed`,
        );
      if (summary.droppedTurns)
        parts.push(
          `${summary.droppedTurns} invalid ${summary.droppedTurns === 1 ? "turn" : "turns"} skipped`,
        );
      if (summary.truncated) parts.push("file trimmed to import limits");
      setNotice(`${parts.join("; ")}.`);
    },
    replaceFrom: (index: number, text: string) => {
      const prior = turnsRef.current.slice(0, index);
      turnsRef.current = prior;
      setTurns(prior);
      remember(prior);
      void runTurn(text, "text");
    },
    retry: () => {
      const list = turnsRef.current;
      let index = list.length - 1;
      while (index >= 0 && list[index]?.role !== "user") index -= 1;
      const text = list[index]?.content;
      if (index < 0 || !text) return;
      const prior = list.slice(0, index);
      turnsRef.current = prior;
      setTurns(prior);
      remember(prior);
      void runTurn(text, "text");
    },
    replay: (text: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      runRef.current += 1;
      const run = runRef.current;
      void speakText(text, ac.signal, () => run === runRef.current && !ac.signal.aborted)
        .then(() => {
          if (run === runRef.current) setMood("idle", "Here");
        })
        .catch((err: unknown) => {
          if (isAbort(err) || run !== runRef.current) return;
          setError("Speech playback failed. The answer is still in the chat.");
        });
    },
    playArrayBuffer: async (data: ArrayBuffer) => {
      setMood("speak", "Speaking");
      try {
        await audioRef.current?.playMp3(data);
        setMood("idle", "Here");
      } catch {
        setError("Could not play that audio.");
        setMood("error", "Paused");
      }
    },
    setInput: (deviceId: string) => {
      audioRef.current?.setInput(deviceId);
    },
    withKey: async <T>(fn: (key: string) => Promise<T>) => {
      if (!keyRef.current) throw new VeniceError(401, "Add a Venice API key first.");
      return fn(keyRef.current);
    },
  };
}
