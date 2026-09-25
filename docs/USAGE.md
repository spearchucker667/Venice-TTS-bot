# Usage

## Text chat

Type in the composer and press Enter, or Shift+Enter for a newline. Slash commands in the composer:

- `/stop` stops playback and the current turn
- `/clear` clears the open chat
- `/settings` opens settings

The same words spoken into the microphone are treated as voice commands. Typed sentences that merely contain those words are not.

## Models

Refresh the catalog after saving a key. Until then, a trait may not resolve and chat will refuse to send an empty model id.

## Voice conversation

Turn on **Back and forth** to listen again after Ember finishes speaking. Hold Space to talk when focus is not in a field. Say "stop", "clear conversation", or "settings" as a short phrase.

## Characters

Open **Characters** from the chat menu, search, and pick a slug. The prompt mode controls whether that slug is sent.

## History

Chats live in IndexedDB (`ember-chats`). The menu can rename, pin, delete, export, and import them. **Clear** empties the open chat. **Clear all local chats** deletes the local database rows.

A copy of the latest turns is also written to `sessionStorage` (`ember.messages.v1`, last 40) so an older session can be imported into the first chat.

## Message actions

On a message you can copy, speak it again, edit an earlier user turn (which drops everything after it and resends), or retry the last user turn.

## Errors

The status line and the red error text are the app's report. Venice 401 means the key was rejected. 402 means the Venice balance is empty. 429 means rate limiting. Speech can fail after the text reply is already saved; the chat is still there.
