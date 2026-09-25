# Voice modes

These are different pipelines. Mixing them up causes the wrong privacy and billing expectations.

## Text to speech

The Voice tab and TTS studio send text to `POST /audio/speech`. Streaming tries `response_format: pcm` at 24000 Hz, 16-bit little-endian, mono. If that response is not audio, the same sentence is requested as MP3.

Text is capped per request (about 1200 characters for the stream path, 4096 for the MP3 path).

## Speech to text

The microphone records with `MediaRecorder` (webm, mp4, or ogg, depending on the browser) and uploads the blob to `POST /audio/transcriptions`. Venice returns text. The audio file is not kept by Ember after the request.

## Conversational voice chat

Speech to text, then chat, then text to speech. The chat model sees the transcript, not the audio. Tools, if enabled, can run before the spoken reply. If a tool call starts, in-flight speech for that round is dropped. The final answer is spoken after tools finish.

Hands-free mode uses a simple level threshold and silence timer. It is not a separate Venice voice agent.

## Voice changer

Separate from chat. The flow is:

1. `POST /audio/voice-changer/quote` with model and duration.
2. `POST /audio/voice-changer/queue` once, with the file and voice.
3. Poll `POST /audio/voice-changer/retrieve` until audio comes back.
4. `POST /audio/voice-changer/complete` to release Venice-side media.

Ember does not automatically queue a second time. A failed retrieve is not a new queue. Closing the panel does not refund a quote you already accepted by queueing.

## Latency

Sentence-level TTS starts before the full reply is finished, which is why the first sentence can play while later tokens are still arriving. Tool rounds wait. MP3 fallback is slower than PCM. Voice changer is asynchronous and can take longer than a TTS sentence.
