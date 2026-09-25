import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/\S+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const href = match[2] || match[3] || "";
    const label = match[1] || match[3] || href;
    nodes.push(
      <a key={`${key}-${index}`} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>,
    );
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichText({ text }: { text: string }) {
  const blocks = text.split("```");
  return (
    <div className="rich">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const splitAt = block.indexOf("\n");
          const code = (splitAt >= 0 ? block.slice(splitAt + 1) : block).replace(/\n$/, "");
          return (
            <pre key={index} className="code-block">
              <code>{code}</code>
            </pre>
          );
        }
        return block
          .split("\n")
          .map((line, lineNo) => (
            <p key={`${index}-${lineNo}`}>{line ? inline(line, `${index}-${lineNo}`) : "\u00a0"}</p>
          ));
      })}
    </div>
  );
}
