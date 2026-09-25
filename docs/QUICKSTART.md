# Quick start

## Prerequisites

- Node.js 22 (the CI image is `node-version: 22`)
- npm 10, matching the lockfile
- A Venice inference key created in your Venice account

## Install and start

```bash
npm ci
npm run dev
```

The dev script listens on `0.0.0.0:8080`. In a normal clone, open `http://127.0.0.1:8080/`.

## First text reply

1. Paste the key and choose **This session** or **Remember**.
2. Open the gear and **Refresh catalog** so traits resolve to live model ids.
3. Type a message and press Enter.

If chat says no text model is selected, the catalog refresh did not return a model for the chosen trait. Pick a specific model under **Model** after the refresh.

## First spoken reply

Leave **Speak replies** on (Voice tab). Send a short message. Ember requests speech as sentences finish. If Venice rejects the streaming PCM request, that sentence is requested again as MP3.

## First microphone check

Click the microphone, or hold Space outside a text field. The browser will ask for microphone permission. Audio is uploaded to Venice for transcription. Deny the permission and Ember stops with a microphone error; nothing is uploaded.
