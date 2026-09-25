# Testing

## Automated

`npm test` runs:

- Node tests under `scripts/**/*.test.mjs` (PWA/OG injection, preview tooling, brand checks)
- TypeScript tests for auth/app-data scaffold, URL policy, SSE parsing, mic track cleanup, the Venice proxy allowlist, chats, presets, and the context window

`npm run check:auth` checks the auth-off invariant used by this app.

`npm run typecheck` is `tsc --noEmit`.

Browser smoke is `node scripts/browser-smoke.mjs` against a running dev server, then again against `npm run preview:restart` for the production bundle. It checks visible text, console errors, overflow, and that a canvas is not treated as a game. The lamp is drawn in a closed shadow so the page is not classified as a game.

## Manual

- Paste a key and refresh the catalog (needs a real Venice key; CI does not have one).
- Send a text turn.
- Allow the microphone and speak a short sentence.
- Stop playback mid-sentence.
- Open Voice Changer, quote, and only then queue if you accept the charge.
- Export and import a chat.
- Resize to about 390 px wide and confirm the composer is on screen.

## What CI does not prove

CI does not call Venice. A green build does not mean your key, model id, or voice id works today.
