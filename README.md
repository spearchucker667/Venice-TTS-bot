# Ember

Venice-powered voice and chat in the browser. You bring an inference key, pick models and a voice from your Venice account, and talk or type. Ember does not train model weights and does not create API keys.

![Ember hero: a glass lamp-like orb on a dark field, with abstract chat and audio shapes](docs/assets/ember-hero.png)

Status badges are not shown yet. This workspace has no GitHub repository URL, so a CI or release badge would be invented. Add badges only after the workflows exist on the real repository. See [docs/GITHUB_ADMIN.md](docs/GITHUB_ADMIN.md).

## What it does

- Text chat streamed from Venice, with a system prompt and optional Venice character.
- Speech in, text, then speech out. Playback can start on the first finished sentence.
- A separate Voice Changer: quote a clip, then queue that conversion once.
- A lamp you can recolor and restyle while the conversation stays on screen.
- Chats, the catalog cache, and the API key stay in this browser. The app does not write the key to a server.

![Ember on a wide screen, with the chat list, the lamp, and the key card](docs/assets/ember-app.png)

![Ember on a phone, with the lamp above the composer](docs/assets/ember-mobile.png)

## Voice, in one pass

```text
typed text ─────────────────────────────┐
microphone audio → Venice transcription ┤
                                        ↓
                                 Venice chat
                                        ↓
                              streamed reply text
                                        ↓
                         Venice speech → speakers
```

Voice Changer does not go through the chat model. It sends the audio file to Venice's speech-to-speech queue after a quote. Details: [docs/VOICE_MODES.md](docs/VOICE_MODES.md).

![Data-flow diagram](docs/assets/architecture.svg)

## Run it

Node 22, then:

```bash
npm ci
npm run dev
```

Open the app and paste a Venice inference key. Choose **This session** or **Remember**. Create the key in your Venice account. Ember never calls the key-creation endpoint.

The key is sent as `Authorization: Bearer` to this app's `/api/venice` proxy, which forwards it to `https://api.venice.ai/api/v1`. The proxy does not store the key. Full steps: [docs/QUICKSTART.md](docs/QUICKSTART.md).

## Settings

The gear opens Key, Model, Persona, Voice, Tools, and Changer. Generation presets only set temperature and top P. They are not fine-tuning.

![Settings on the Key tab, with session or remember and a catalog refresh](docs/assets/ember-settings.png)

What each control does: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Security and privacy

Prompts, microphone audio, transcripts, and generated speech are sent to Venice through the proxy. Chat history is stored locally (IndexedDB, plus a short session copy). There is no product analytics client in the Ember UI.

Read [PRIVACY.md](PRIVACY.md) and [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) before filing a bug with logs. Do not paste API keys into issues. Vulnerability reports go through the process in [SECURITY.md](SECURITY.md), not a public issue.

## Develop

```bash
npm ci
npm run dev
npm run lint
npm run format:check
npm run typecheck
npm run check:auth
npm test
npm run build
npm run release:check
```

More: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [docs/TESTING.md](docs/TESTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Docs

- [Quick start](docs/QUICKSTART.md)
- [Installation](docs/INSTALLATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [Usage](docs/USAGE.md)
- [Voice modes](docs/VOICE_MODES.md)
- [Venice API](docs/VENICE_API.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)

## Legal

No license has been selected. This repository is not open source until a `LICENSE` file is added on purpose. See [docs/LEGAL.md](docs/LEGAL.md).

Venice and xAI names belong to their owners. Ember is an independent client. See [TRADEMARKS.md](TRADEMARKS.md).
