import { useEffect, useId, useLayoutEffect, useRef } from "react";
import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { ChatStatus, HistoryEntry } from "./types";
import type mermaidType from "mermaid";

type MermaidApi = typeof mermaidType;
let mermaidLoader: Promise<MermaidApi> | undefined;

function loadMermaid(): Promise<MermaidApi> {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    return mermaid;
  });
  return mermaidLoader;
}

export default function Conversation({
  history,
  status,
  hasMoreHistory,
  historyLoading,
  hideToolCalls,
  onLoadOlder,
}: {
  history: HistoryEntry[];
  status: ChatStatus;
  hasMoreHistory: boolean;
  historyLoading: boolean;
  hideToolCalls: boolean;
  onLoadOlder: () => void;
}) {
  const conversation = useRef<HTMLElement>(null);
  const positionedAtLatest = useRef(false);

  useLayoutEffect(() => {
    if (historyLoading || !history.length || positionedAtLatest.current) return;
    conversation.current!.scrollTop = conversation.current!.scrollHeight;
    positionedAtLatest.current = true;
  }, [history.length, historyLoading]);

  return (
    <section
      aria-label="Conversation"
      className="conversation"
      ref={conversation}
    >
      {!history.length && !historyLoading && status !== "starting" && (
        <div className="empty-state">
          <span className="empty-orb">✦</span>
          <h2>What can I help you build?</h2>
          <p>
            Ask Pi to explore this project, implement a feature, or review a
            change.
          </p>
        </div>
      )}
      {hasMoreHistory && (
        <button
          className="load-older-history"
          disabled={historyLoading}
          onClick={onLoadOlder}
          type="button"
        >
          {historyLoading
            ? "Loading earlier messages…"
            : "Load earlier messages"}
        </button>
      )}
      <div className="history">
        {history.map(
          (entry, index) =>
            (!hideToolCalls || entry.kind !== "tool") && (
              <HistoryEntryView
                entry={entry}
                key={historyEntryKey(entry, index)}
              />
            ),
        )}
      </div>
      {historyLoading && (
        <div
          aria-label="Loading latest history"
          className="thinking-indicator"
          role="status"
        >
          <span aria-hidden="true" /> Loading latest history…
        </div>
      )}
      {status === "streaming" && (
        <div
          aria-label="Pi is working"
          className="thinking-indicator"
          role="status"
        >
          <span aria-hidden="true" /> Pi is working…
        </div>
      )}
    </section>
  );
}

function HistoryEntryView({ entry }: { entry: HistoryEntry }) {
  if (entry.kind === "notification") {
    return (
      <div
        className={`extension-notification extension-notification-${entry.level}`}
        role={entry.level === "info" ? "status" : "alert"}
      >
        <strong>Pi · {entry.level}</strong>
        <pre>{entry.message}</pre>
      </div>
    );
  }
  return entry.kind === "message" ? (
    <article className={`message message-${entry.role}`}>
      <span className="message-avatar">
        {entry.role === "user" ? "You" : "π"}
      </span>
      <div>
        <strong>{entry.role === "user" ? "You" : "Pi"}</strong>
        <div className="markdown">
          <ReactMarkdown
            components={{
              code({ children, className, ...props }) {
                const language = /language-(\S+)/.exec(className ?? "")?.[1];
                if (language === "mermaid")
                  return <MermaidDiagram chart={String(children).trim()} />;
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
            rehypePlugins={[rehypeKatex]}
            remarkPlugins={[remarkGfm, remarkMath]}
          >
            {normalizeMarkdown(normalizeMath(entry.text))}
          </ReactMarkdown>
        </div>
      </div>
    </article>
  ) : (
    <details
      className={`tool ${entry.isError ? "tool-error" : "tool-success"}`}
    >
      <summary>
        <span aria-hidden="true">⌘</span>
        <span>{entry.name}</span>
        {entry.target && <code>{entry.target}</code>}
        <em>
          {entry.isRunning ? "running" : entry.isError ? "failed" : "completed"}
        </em>
      </summary>
      <pre>{entry.output || "Running…"}</pre>
    </details>
  );
}

function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diagramId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();
    void (async () => {
      const mermaid = await loadMermaid();
      if (disposed || !containerRef.current) return;

      const { svg, bindFunctions } = await mermaid.render(
        `mermaid-${diagramId}`,
        chart,
      );
      if (disposed || !containerRef.current) return;
      containerRef.current.innerHTML = svg;
      bindFunctions?.(containerRef.current);
    })().catch((error: unknown) =>
      console.error("Could not render Mermaid diagram", error),
    );

    return () => {
      disposed = true;
    };
  }, [chart, diagramId]);

  return (
    <div
      aria-label="Mermaid diagram"
      className="mermaid-diagram"
      ref={containerRef}
    />
  );
}

function historyEntryKey(entry: HistoryEntry, index: number): string {
  return entry.kind === "tool"
    ? `tool-${entry.id}-${index}`
    : `${entry.kind}-${index}`;
}

function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, "$$\n$1\n$$")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");
}

function normalizeMarkdown(text: string): string {
  const delimiter = /\|(?:\s*:?-{3,}:?\s*\|)+/;
  const match = delimiter.exec(text);
  if (!match) return text;

  const tableStart = text.lastIndexOf("\n", match.index) + 1;
  const beforeTable = text.slice(0, tableStart);
  const flattenedTable = text.slice(tableStart).trim();
  if (flattenedTable.includes("\n")) return text;

  const columnCount = match[0].split("|").filter(Boolean).length;
  const cells = flattenedTable
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length < columnCount * 2) return text;

  const rows = cells
    .filter((_, index) => index < columnCount || index >= columnCount * 2)
    .reduce<string[]>((result, cell, index) => {
      if (index % columnCount === 0) result.push("");
      result[result.length - 1] += `| ${cell} `;
      return result;
    }, [])
    .map((row) => `${row}|`);

  return `${beforeTable}${rows[0]}\n${match[0]}\n${rows.slice(1).join("\n")}`;
}
