# Obsidian-like Dataview

Dataview-style DQL and DataviewJS queries over Markdown notes, for VS Code.

## What it does

- Indexes every Markdown file in the workspace (frontmatter, inline `key:: value` fields, `#tags`, `[[wikilinks]]`, `- [ ]` tasks) and keeps the index live via a file watcher.
- Parses and runs `LIST` / `TABLE` / `TASK` / `CALENDAR` DQL queries (`FROM`, `WHERE`, `SORT`, `GROUP BY`, `LIMIT`, `FLATTEN`, most Dataview built-in functions).
- Runs ```dataviewjs blocks in a sandboxed Node `vm` context exposing a `dv` API subset (`dv.pages`, `dv.page`, `dv.current`, `dv.table`, `dv.list`, `dv.taskList`, `dv.header`, `dv.paragraph`).
- Renders ```dataview / ```dql / ```dataviewjs fenced blocks directly in VS Code's built-in Markdown preview.

## Commands

- `Dataview: Reindex Workspace`
- `Dataview: Show Query Result for Block at Cursor` (opens the result in a side panel)

## Settings

- `obsidianlikeDataview.include` / `obsidianlikeDataview.exclude` — glob patterns for the workspace index.
- `obsidianlikeDataview.dataviewJs.enabled` — toggle ```dataviewjs execution (default `true`).

## Using this from another extension

`activate()` returns an `ObsidianlikeDataviewApi` object (also reachable via `vscode.extensions.getExtension('angelCastro.obsidianlike-dataview')?.exports`):

```ts
const dv = vscode.extensions.getExtension("angelCastro.obsidianlike-dataview")?.exports;
const result = dv.runQuery('LIST FROM #project WHERE !completed');
const html = dv.renderQueryResultHtml(result);
```

See `src/extension.ts` for the full API surface (`runQuery`, `runDataviewJs`, `findDataviewBlocks`, `renderQueryResultHtml`, `renderDataviewJsOutputHtml`, `getAllPages`, `getPage`, `reindexWorkspace`, `onDidChangeIndex`).

### Consumed by `obsidianlike` (soft dependency, host-to-host only)

The `angelCastro.obsidian-like` extension (repo `c:\git\obsidianlike`) renders ```dataview/```dql/```dataviewjs blocks inside its own CodeMirror-based custom editor — a webview, not VS Code's built-in Markdown preview — so `extendMarkdownIt` (below) never runs for it. Instead, `obsidianlike`'s extension host calls this extension's exported API directly (`getExtension(...).activate()`, no `extensionDependencies` entry — this stays optional on both sides) and forwards the resulting HTML to its webview via `postMessage`. See `obsidianlike/CLAUDE.md`'s "Dataview query blocks" sections for the full round-trip.

This is the reason `renderQueryResultHtml`'s links use `<a class="dv-link" href="#" data-wiki="...">` rather than a `command:` URI: a plain custom-editor webview has no built-in handling for `command:` links (only VS Code's own Markdown preview does), while `data-wiki` is a convention `obsidianlike`'s click handler already understands generically. If this markup ever changes, `obsidianlike`'s side needs updating too — there's no compile-time coupling between the two repos, just an HTML/class-name contract kept in sync manually.

## Development

```sh
npm install
npm run compile   # or: npm run watch
npm test
```

Press F5 in VS Code to launch an Extension Development Host.

## Security note

`dataviewjs` blocks execute arbitrary JavaScript found in your own notes via Node's `vm` module. `vm` is not a hard security boundary — it prevents accidental access to `require`/`process`/the filesystem from well-behaved scripts, but should not be relied on against a maliciously crafted note from an untrusted source. Disable `obsidianlikeDataview.dataviewJs.enabled` if you open workspaces you don't fully trust.
