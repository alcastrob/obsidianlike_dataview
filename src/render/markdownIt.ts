import { parseQuery } from "../parser/parser";
import { runQuery } from "../engine/queryEngine";
import { runDataviewJsSync } from "../dataviewjs/sandbox";
import { renderDataviewJsOutputHtml, renderQueryResultHtml } from "./html";
import { WorkspaceIndex } from "../indexer/workspaceIndex";

interface MarkdownItLike {
  renderer: {
    rules: Record<string, unknown>;
  };
}

interface FenceToken {
  info: string;
  content: string;
}

type FenceRenderer = (tokens: FenceToken[], idx: number, options: unknown, env: unknown, self: unknown) => string;

/** Registers a fence renderer that intercepts ```dataview / ```dql / ```dataviewjs blocks in the
 *  built-in VS Code Markdown preview and replaces them with rendered results. */
export function registerDataviewMarkdownIt(md: MarkdownItLike, index: WorkspaceIndex, dataviewJsEnabled: () => boolean): MarkdownItLike {
  const defaultFence = md.renderer.rules["fence"] as FenceRenderer | undefined;

  const fenceRenderer: FenceRenderer = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim().toLowerCase();

    if (info === "dataview" || info === "dql") {
      try {
        const query = parseQuery(token.content);
        const result = runQuery(query, index.getAllPages(), { resolveLinkPath: (raw) => index.resolveLinkPath(raw) });
        return `<div class="dataview-result">${renderQueryResultHtml(result)}</div>`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `<div class="dataview-result dv-error">Dataview error: ${escapeHtml(message)}</div>`;
      }
    }

    if (info === "dataviewjs") {
      if (!dataviewJsEnabled()) {
        return `<div class="dataview-result dv-error">DataviewJS is disabled (obsidianlikeDataview.dataviewJs.enabled).</div>`;
      }
      const result = runDataviewJsSync(token.content, index.getAllPages(), "", (raw) => index.resolveLinkPath(raw) ?? raw);
      return `<div class="dataview-result">${renderDataviewJsOutputHtml(result.output, result.error)}</div>`;
    }

    if (defaultFence) return defaultFence(tokens, idx, options, env, self);
    return `<pre><code>${escapeHtml(token.content)}</code></pre>`;
  };

  md.renderer.rules["fence"] = fenceRenderer;
  return md;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
