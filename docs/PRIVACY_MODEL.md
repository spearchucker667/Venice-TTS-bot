# Privacy model

Ember does not run its own account system. "Stays in this browser" means the key and chats are not written to an Ember database. It does not mean the conversation stays on the device. Chat and audio are sent to Venice.

## What leaves the browser

| Data                              | Where it goes                         | When                                               |
| --------------------------------- | ------------------------------------- | -------------------------------------------------- |
| API key                           | App proxy, then Venice                | Every Venice request                               |
| System prompt, history, user text | Venice chat                           | Each turn                                          |
| Microphone recording              | Venice transcriptions                 | After you stop the mic                             |
| Reply text                        | Venice speech                         | When speak-replies is on, or TTS studio, or replay |
| Voice changer file                | Venice voice-changer queue            | After you queue a quoted take                      |
| Tool URL or search query          | Venice augment, or the confirmed host | When a tool runs                                   |

The proxy sees the body because it forwards it. It is not designed to store requests.

## What stays on the device

| Store                           | Key                                                   | Contents                                                                 |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| localStorage or sessionStorage  | `ember.apiKey`                                        | Venice key                                                               |
| localStorage                    | `ember.keyMode.v1`                                    | session or remember                                                      |
| localStorage                    | `ember.persona.v1`                                    | name, prompt, models, voice, lamp                                        |
| localStorage                    | `ember.catalog.v1`                                    | last catalog                                                             |
| localStorage                    | `ember.integrations.v1`                               | scoped HTTP integrations the user defined (origin, path prefix, methods) |
| sessionStorage (in-memory only) | session tool grants                                   | short-lived read approvals; never persisted                              |
| localStorage                    | `ember.favCharacters.v1`, `ember.recentCharacters.v1` | character slugs                                                          |
| sessionStorage                  | `ember.messages.v1`                                   | last 40 turns                                                            |
| IndexedDB `ember-chats`         | `chats`                                               | full local chat records                                                  |

Clearing site data in the browser deletes these. Export writes a JSON file you choose. Import reads a file you choose.

## Telemetry

The Ember UI does not initialize an analytics or product-telemetry client. The repository still contains platform libraries used by the Grok Build scaffold, including auth code that is disabled for this app. Those libraries are not part of the voice request path while auth stays off.

## Retention

Ember does not set a server retention period because it does not keep the conversation on a server. Venice's retention is Venice's policy, not this repository's.

Microphone blobs are not stored after the transcription request finishes. Voice changer playback uses the audio returned for that queue and then asks Venice to delete its media. The local chat still contains the text, not the recording.
