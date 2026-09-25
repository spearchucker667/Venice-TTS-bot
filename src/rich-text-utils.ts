/**
 * Utilities for rich text and Markdown processing.
 * Audit IDs: UI-007, UI-008.
 */

/**
 * UI-007: Strip trailing punctuation that belongs to surrounding prose, not the URL.
 * Handles trailing dots, commas, colons, semicolons, exclamation marks, question marks,
 * and closing parentheses/brackets.
 */
export function trimUrlPunctuation(raw: string): { url: string; trailing: string } {
  const match = raw.match(/([.,!?:;)\]}]+)$/);
  if (!match) return { url: raw, trailing: "" };
  return {
    url: raw.slice(0, -match[1].length),
    trailing: match[1],
  };
}
