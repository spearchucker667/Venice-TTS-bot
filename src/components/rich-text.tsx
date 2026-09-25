import { useState, type ReactNode } from "react";
import { trimUrlPunctuation } from "@/rich-text-utils";

export { trimUrlPunctuation };

export function parseInline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/\S+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));

    if (match[2]) {
      // Markdown link: [label](url)
      const href = match[2];
      const label = match[1] || href;
      nodes.push(
        <a key={`${key}-${index}`} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    } else if (match[3]) {
      // Bare URL: trim trailing punctuation (UI-007)
      const { url, trailing } = trimUrlPunctuation(match[3]);
      nodes.push(
        <a key={`${key}-${index}`} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (trailing) {
        nodes.push(trailing);
      }
    }

    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="code-block-wrapper" style={{ position: "relative", margin: "0.5rem 0" }}>
      <div
        className="code-block-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.75rem",
          padding: "0.2rem 0.6rem",
          opacity: 0.8,
        }}
      >
        <span className="code-block-lang">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Code copied to clipboard" : "Copy code to clipboard"}
          style={{
            fontSize: "0.75rem",
            padding: "0.15rem 0.5rem",
            cursor: "pointer",
            borderRadius: "0.3rem",
            background: "transparent",
            color: "inherit",
            border: "1px solid currentColor",
            opacity: 0.9,
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="code-block" style={{ margin: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function RichText({ text }: { text: string }) {
  const blocks = text.split("```");
  return (
    <div className="rich">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const splitAt = block.indexOf("\n");
          const language = (splitAt >= 0 ? block.slice(0, splitAt) : "").trim();
          const code = (splitAt >= 0 ? block.slice(splitAt + 1) : block).replace(/\n$/, "");
          return <CodeBlock key={index} code={code} language={language} />;
        }
        return block
          .split("\n")
          .map((line, lineNo) => (
            <p key={`${index}-${lineNo}`}>
              {line ? parseInline(line, `${index}-${lineNo}`) : "\u00a0"}
            </p>
          ));
      })}
    </div>
  );
}
