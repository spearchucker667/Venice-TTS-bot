/** Incremental SSE decoder. Handles CRLF, multi-line data, comments, and a final event without a trailing blank line. */

export type SseFrame = { event: string; data: string };

export function createSseParser(onFrame: (frame: SseFrame) => void): {
  push: (chunk: string) => void;
  finish: () => void;
} {
  let buf = "";

  const emitBlock = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const cut = line.indexOf(":");
      const field = (cut === -1 ? line : line.slice(0, cut)).trim();
      let value = cut === -1 ? "" : line.slice(cut + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) onFrame({ event, data: data.join("\n") });
  };

  const drain = (final: boolean) => {
    while (buf.length) {
      const match = /\r?\n\r?\n/.exec(buf);
      if (!match || match.index === undefined) break;
      const block = buf.slice(0, match.index);
      buf = buf.slice(match.index + match[0].length);
      if (block.trim()) emitBlock(block);
    }
    if (final && buf.trim()) {
      emitBlock(buf);
      buf = "";
    }
  };

  return {
    push(chunk: string) {
      buf += chunk;
      drain(false);
    },
    finish() {
      drain(true);
    },
  };
}
