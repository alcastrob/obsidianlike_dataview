import * as vscode from "vscode";
import { DataviewBlock, findDataviewBlocks } from "./blocks";
import { runDataviewJs, runDataviewJsSync, DataviewJsResult } from "./dataviewjs/sandbox";
import { DVJsOutputNode } from "./dataviewjs/api";
import { runQuery, QueryResult } from "./engine/queryEngine";
import { WorkspaceIndex } from "./indexer/workspaceIndex";
import { parseQuery } from "./parser/parser";
import { registerDataviewMarkdownIt } from "./render/markdownIt";
import { renderDataviewJsOutputHtml, renderQueryResultHtml } from "./render/html";
import { DVPage } from "./types";

function readConfig() {
  const cfg = vscode.workspace.getConfiguration("obsidianlikeDataview");
  return {
    include: cfg.get<string[]>("include", ["**/*.md"]),
    exclude: cfg.get<string[]>("exclude", ["**/node_modules/**", "**/.git/**"]),
    dataviewJsEnabled: cfg.get<boolean>("dataviewJs.enabled", true),
  };
}

/** Public API exported from this extension for other extensions to consume via
 *  `vscode.extensions.getExtension('alcastrob.obsidianlike-dataview')?.exports`. */
export interface ObsidianlikeDataviewApi {
  runQuery(queryText: string): QueryResult;
  runDataviewJs(code: string, currentFilePath?: string): Promise<DataviewJsResult>;
  findDataviewBlocks(text: string): DataviewBlock[];
  renderQueryResultHtml(result: QueryResult): string;
  renderDataviewJsOutputHtml(nodes: DVJsOutputNode[], error?: string): string;
  getAllPages(): DVPage[];
  getPage(relPath: string): DVPage | undefined;
  reindexWorkspace(): Promise<void>;
  onDidChangeIndex: vscode.Event<void>;
}

let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<ObsidianlikeDataviewApi> {
  outputChannel = vscode.window.createOutputChannel("Obsidian-like Dataview");
  context.subscriptions.push(outputChannel);

  const index = new WorkspaceIndex(() => {
    const { include, exclude } = readConfig();
    return { include, exclude };
  });
  context.subscriptions.push(index);

  await index.initialize();
  outputChannel.appendLine(`Indexed ${index.size} markdown file(s).`);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("obsidianlikeDataview.include") || e.affectsConfiguration("obsidianlikeDataview.exclude")) {
        index.reindexAll();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("obsidianlikeDataview.reindexWorkspace", async () => {
      await index.reindexAll();
      vscode.window.showInformationMessage(`Obsidian-like Dataview: reindexed ${index.size} file(s).`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("obsidianlikeDataview.showQueryResult", async () => {
      await showQueryResultForCursor(index);
    })
  );

  const api: ObsidianlikeDataviewApi = {
    runQuery: (queryText: string) => {
      const query = parseQuery(queryText);
      return runQuery(query, index.getAllPages(), { resolveLinkPath: (raw) => index.resolveLinkPath(raw) });
    },
    runDataviewJs: (code: string, currentFilePath?: string) =>
      runDataviewJs(code, index.getAllPages(), currentFilePath ?? "", (raw) => index.resolveLinkPath(raw) ?? raw),
    findDataviewBlocks,
    renderQueryResultHtml,
    renderDataviewJsOutputHtml,
    getAllPages: () => index.getAllPages(),
    getPage: (relPath: string) => index.getPage(relPath),
    reindexWorkspace: () => index.reindexAll(),
    onDidChangeIndex: index.onDidChange,
  };

  // Stash a reference so extendMarkdownIt (invoked separately by VS Code's markdown extension host)
  // can reach the same live index.
  activeIndex = index;

  return api;
}

let activeIndex: WorkspaceIndex | undefined;

/** Entry point VS Code's built-in Markdown preview calls when `contributes.markdown.markdownItPlugins`
 *  is set, letting us render ```dataview/```dql/```dataviewjs blocks directly in the preview. */
export function extendMarkdownIt(md: unknown): unknown {
  if (!activeIndex) return md;
  return registerDataviewMarkdownIt(md as Parameters<typeof registerDataviewMarkdownIt>[0], activeIndex, () => readConfig().dataviewJsEnabled);
}

async function showQueryResultForCursor(index: WorkspaceIndex): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    vscode.window.showWarningMessage("Open a Markdown file and place the cursor inside a dataview block.");
    return;
  }

  const text = editor.document.getText();
  const cursorLine = editor.selection.active.line;
  const blocks = findDataviewBlocks(text);
  const block = blocks.find((b) => cursorLine >= b.startLine && cursorLine <= b.endLine);
  if (!block) {
    vscode.window.showWarningMessage("Cursor is not inside a ```dataview/```dql/```dataviewjs block.");
    return;
  }

  const panel = vscode.window.createWebviewPanel("obsidianlikeDataviewResult", "Dataview Result", vscode.ViewColumn.Beside, {
    enableScripts: false,
  });

  let bodyHtml: string;
  if (block.lang === "dataviewjs") {
    const result = await runDataviewJs(block.query, index.getAllPages(), vscode.workspace.asRelativePath(editor.document.uri, false), (raw) => index.resolveLinkPath(raw) ?? raw);
    bodyHtml = renderDataviewJsOutputHtml(result.output, result.error);
  } else {
    try {
      const query = parseQuery(block.query);
      const result = runQuery(query, index.getAllPages(), { resolveLinkPath: (raw) => index.resolveLinkPath(raw) });
      bodyHtml = renderQueryResultHtml(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bodyHtml = `<div class="dv-error">${message}</div>`;
    }
  }

  panel.webview.html = wrapHtml(bodyHtml);
}

function wrapHtml(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 8px 16px; color: var(--vscode-foreground); }
  table.dv-table { border-collapse: collapse; width: 100%; }
  table.dv-table th, table.dv-table td { border: 1px solid var(--vscode-panel-border, #444); padding: 4px 8px; text-align: left; }
  .dv-error { color: var(--vscode-errorForeground, #f66); }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function deactivate(): void {
  activeIndex = undefined;
}
