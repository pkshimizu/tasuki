/**
 * エージェントが書いた文章（Markdown）の表示。長いものは折りたたむ。
 */
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Messages } from "../i18n.js";
import { Icon, ICONS } from "./Icon.js";

/** これより行数の多い文章は折りたたむ */
const COLLAPSE_LINES = 7;

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // リンクは別のタブで開く（管理画面から離れないように）
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** 文章の行数（空行は数えない） */
export function lineCount(text: string): number {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

export function MarkdownBox({
  t,
  text,
  collapsible = true,
}: {
  t: Messages;
  text: string;
  collapsible?: boolean;
}) {
  const lines = lineCount(text);
  const long = collapsible && lines > COLLAPSE_LINES;
  const [open, setOpen] = useState(false);
  if (text.trim().length === 0) return null;
  return (
    <div className="md-wrap">
      <div className={long && !open ? "md-box closed" : "md-box"}>
        <Markdown text={text} />
        {long && !open && <div className="md-fade" aria-hidden="true" />}
      </div>
      {long && (
        <button
          type="button"
          className="md-more"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <Icon
            d={open ? ICONS.chevronUp : ICONS.chevronDown}
            size={12}
            stroke={2}
          />
          {open ? t.common.collapse : t.common.showAll(lines)}
        </button>
      )}
    </div>
  );
}
