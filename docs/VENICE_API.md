# Venice API

Ember is an independent client. It is not a Venice product, and this page is not the Venice documentation. Official reference: [docs.venice.ai](https://docs.venice.ai/).

## Authentication

The browser sends `Authorization: Bearer <key>` to the same-origin route `/api/venice/*`. The server checks the path against an allowlist and forwards the header to `https://api.venice.ai/api/v1`. The key is not written to a database. Error bodies returned to the browser are truncated and have the key string removed if it appeared.

`POST /api_keys` is rejected. Creating keys is an account action on Venice's side.

## Allowlist

GET:

- `/models` (short query, such as `type=text`)
- `/models/traits`
- `/models/compatibility_mapping`
- `/models/{id}`
- `/characters` (search and paging query, length-capped)
- `/characters/{slug}`

POST:

- `/chat/completions`
- `/audio/speech`
- `/audio/transcriptions`
- `/audio/voice-changer/quote`
- `/audio/voice-changer/queue`
- `/audio/voice-changer/retrieve`
- `/audio/voice-changer/complete`
- `/augment/search`
- `/augment/scrape`

Anything else, including billing and key management, is not proxied.

## Catalog

Model ids are whatever Venice returns at refresh time. Traits such as `function_calling_default` are resolved through `/models/traits`. If the trait is missing, chat does not invent an id.

Compatibility data is stored when the mapping endpoint returns string lists. It is a hint in the voice settings, not a guarantee that a voice id will work.

## Chat parameters Ember sends

`model`, `messages`, `temperature`, `top_p`, `stream`, and `venice_parameters` (`include_venice_system_prompt: false`, web search mode, optional `character_slug`, thinking flags). `max_completion_tokens` and frequency/presence penalties are included only when set. Tools are the three functions described in the security model, and only when the tools toggle is on.

## Errors

401 invalid key, 402 empty balance, 429 rate limit, other statuses surfaced as a short message. Ember does not retry a Voice Changer queue on its own.

Rate-limit numbers and prices change. Use Venice's own docs and the quote endpoint rather than a number copied here.
