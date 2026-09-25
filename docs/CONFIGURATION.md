# Configuration

Settings are stored in this browser. Nothing here is a server config file.

## Key

- **This session** stores the key in `sessionStorage` (`ember.apiKey`) and clears the local copy.
- **Remember** stores it in `localStorage` under the same name.
- The mode itself is `localStorage` key `ember.keyMode.v1`.
- Remove key deletes both copies.
- **Refresh catalog** calls Venice for text, speech, and hearing models, traits, a character page, and the compatibility map.

The app does not call `POST /api_keys`.

## Model

- Trait or a specific text model id. A trait is sent only after the catalog maps it. There is no hardcoded fallback model id.
- Presets **Balanced**, **Creative**, **Precise**, **Reasoning**, and **Coding** set temperature and top P. Moving a slider marks the preset **Custom**.
- Max tokens `0` omits `max_completion_tokens`. Any value of at least 16 is sent.
- Frequency and presence penalties are sent only when they are not zero.
- These controls do not fine-tune weights.

## Persona

- Spoken name and system prompt (up to 8000 characters). Prompt presets replace the prompt text. **Reset prompt** restores the built-in companion prompt.
- **Prompt mode**
  - **Blend** sends your prompt and, if set, the character slug.
  - **Persona** sends your prompt and omits the character slug.
  - **Character** sends a short in-character instruction plus the slug, not the long persona prompt.
- Character search uses Venice `/characters`. Favorites and recent slugs are local (`ember.favCharacters.v1`, `ember.recentCharacters.v1`).

## Voice

- Speech model and voice id. Voices come from the catalog when Venice returns them. You can type a cloned voice id.
- Speed, hearing (STT) model, speak-replies toggle.
- Hands-free threshold (VAD).
- Optional microphone device id for the next recording.
- **TTS studio** speaks the box without adding a chat turn.

## Tools

- Web search: off, auto, or on. This is Venice's `enable_web_search` parameter.
- Tools toggle adds Venice search, Venice scrape, and a browser HTTP tool.
- Read requests can be remembered per host (`ember.hosts.v1`). Writes always ask. Private, loopback, and metadata addresses are blocked in the browser. Redirects are not followed.

## Changer

Voice Changer model id (blank uses the documented example `elevenlabs-voice-changer`), voice, optional seed, background-noise flag, file, and duration. Quote first. Queue runs once per take. **New take** clears the queue id; it does not retry the previous charge.

## Lamp

Color and motion (Flow, Churn, Core, Drift) are persona fields. Reduced-motion preference freezes the shader motion and draws at a low frame rate.

## What is not a setting

There is no account, no cloud sync, and no server-side persona. Export/import is a JSON file of local chats, not a backup service.
