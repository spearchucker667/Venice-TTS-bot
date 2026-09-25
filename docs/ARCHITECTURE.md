# Architecture

```text
src/components/   studio, lamp, chat menu, voice changer, rich text
src/use-ember.ts  turn loop, mic, speech queue, chat actions
src/venice.ts     catalog, chat, speech, tools, voice changer client
src/lib/venice-proxy.server.ts
src/routes/api/venice/$.ts   same-origin proxy entry
src/state.ts      persona, key, prompt, context window
src/chats.ts      IndexedDB
src/audio.ts      mic, PCM playback, MP3 playback
src/speech.ts     commands, sentence split, spoken-text cleanup
src/tools/policy.ts   URL and private-network checks
```

Platform auth, database, and PWA files under `src/lib/auth`, `src/lib/app-data`, `server/`, and `scripts/grok-pwa-*` are part of the Grok Build scaffold. Ember's voice flow does not require them. Do not delete them to "simplify" a clone that still builds with that scaffold.

## Trust boundaries

| Boundary                     | What crosses it                                                         |
| ---------------------------- | ----------------------------------------------------------------------- |
| Browser storage              | Key, persona, catalog cache, chats, approved read hosts                 |
| Browser to app proxy         | Bearer key plus the JSON or audio body                                  |
| Proxy to Venice              | The same request, if the path is allowlisted                            |
| Browser to a third-party URL | Only after the HTTP tool is confirmed, and only to public http(s) hosts |
| Model to tool arguments      | Untrusted. Tool results are wrapped before they go back to the model    |

The HTTP tool runs in the browser. It cannot see DNS answers, so a public name that resolves to a private address is a known limit. Literal private addresses, credentials in the URL, and non-80/443 ports are blocked. Redirects are not followed.

## Context

`contextWindow` keeps the newest turns under a rough character budget and tries not to start mid-tool. It is an estimate (about 4 characters per token), not a tokenizer.

## Deployment shape

Vite builds a TanStack Start app with a Nitro server preset for Vercel. The proxy is a server function. The client bundle does not contain a Venice key.
