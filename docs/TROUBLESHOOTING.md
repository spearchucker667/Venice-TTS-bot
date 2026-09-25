# Troubleshooting

Do not paste your Venice key into an issue or a chat log.

## The key is rejected

Venice returned 401. Create or rotate the key in your Venice account and save it again in Ember. Remember and This session are different stores; check which one is selected.

## Balance or rate limit

402 means the Venice balance is empty. 429 means Venice is rate-limiting the key. Ember does not hide these behind a retry loop.

## No models

Refresh catalog on the Key tab. If the text list is empty, the trait selector has nothing to resolve and chat will refuse to send. The message in the Model tab is the catalog notice from the last refresh.

## Voice does not match the speech model

Voices are per speech model. After changing the model, Ember loads voices for that id when the key is present. A typed voice id is sent as-is; Venice may reject it.

## Microphone

If the browser blocked the permission, Ember says so. Check the site permission, not the Venice key. A very short recording (under about 800 bytes) is ignored.

## No sound

Browsers can block audio until a click. Use the microphone or send a message after clicking the page. If speech fails, the text reply can still be in the chat. TTS studio and per-message replay use the same playback path.

## Stale settings

Persona and catalog are cached locally. Refresh the catalog after Venice changes your models. Removing site data deletes the key and chats.

## Tools

A tool error that mentions a blocked address is the network policy, not a Venice outage. Writes wait for Once or Deny. Always is hidden for writes.

## Deployment

`npm run build` does not need `DATABASE_URL`. If a host fails on install scripts or native modules, that is outside Ember's voice path; the app is a Node server plus static assets, not a local database product.

## Schema or PWA tests

`npm test` includes platform PWA injection tests. They should pass without reading Ember's `site.json` into unrelated fixtures. If they fail only when `public/og.jpg` exists, the head injector is using the workspace disk when a test passed an explicit site. That is a bug in `scripts/grok-pwa-shared.mjs`, not a reason to delete the card image.
