/** Turn model text into something worth saying, and catch short voice commands. */

export function presentText(raw: string): { speech: string; thought: string } {
  let thought = "";
  let speech = "";
  const re = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    speech += raw.slice(last, match.index);
    thought += `${match[1]}\n`;
    last = match.index + match[0].length;
  }
  speech += raw.slice(last);
  return {
    speech: speech.replace(/\s+\n/g, "\n").trim(),
    thought: thought.trim(),
  };
}

export function spokenText(raw: string): string {
  const { speech } = presentText(raw);
  const clean = speech
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 8000 ? `${clean.slice(0, 8000)}…` : clean;
}

export function readySentences(text: string): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = text;
  while (rest) {
    const match = /^[\s\S]*?[.!?]+["']?(?=\s|$)/.exec(rest);
    if (!match) break;
    const piece = match[0].trim();
    if (piece.length < 2) break;
    if (/\b(?:Mr|Mrs|Ms|Dr|e\.g|i\.e|vs)\.$/i.test(piece)) break;
    ready.push(piece);
    rest = rest.slice(match[0].length).replace(/^\s+/, "");
  }
  return { ready, rest };
}

export function speechChunks(raw: string): string[] {
  const clean = spokenText(raw);
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const part of parts) {
    const next = buf ? `${buf} ${part}` : part;
    if (next.length > 420 && buf) {
      out.push(buf.trim());
      buf = part;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export type VoiceCommand = "stop" | "clear" | "settings";

export function slashCommand(text: string): VoiceCommand | null {
  const t = text.trim().toLowerCase();
  if (t === "/stop") return "stop";
  if (t === "/clear") return "clear";
  if (t === "/settings") return "settings";
  return null;
}

export function localCommand(text: string): VoiceCommand | null {
  const t = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.split(" ").length > 8) return null;
  if (
    /^(?:please |hey |ok |okay |ember )*(?:stop talking|be quiet|shut up|stop|quiet|silence|enough|pause|halt)(?: please| now)?$/.test(
      t,
    )
  ) {
    return "stop";
  }
  if (
    /^(?:please |hey |ember )*(?:clear(?: the)? conversation|clear|forget this|forget everything|forget that|start over|new chat|reset(?: chat)?)(?: please)?$/.test(
      t,
    )
  ) {
    return "clear";
  }
  if (
    /^(?:please |hey |ember )*(?:open settings|settings|persona|change persona|change your persona)(?: please)?$/.test(
      t,
    )
  ) {
    return "settings";
  }
  return null;
}
