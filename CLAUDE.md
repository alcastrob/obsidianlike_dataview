# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension (`.vsix`) that reimplements the core of Obsidian's **Dataview** plugin: ```dataview```/```dql``` query blocks (`LIST`/`TABLE`/`TASK`/`CALENDAR`, `FROM`/`WHERE`/`SORT`/`GROUP BY`/`LIMIT`/`FLATTEN`) and ```dataviewjs``` blocks (sandboxed JS with a `dv` API), run against every Markdown file in the workspace. Installed locally into the same VS Code profile as the rest of the `obsidianlike*` family — no marketplace, no external servers.

It does **not** render anything on its own screen by default. It's a query engine + two rendering surfaces:
1. `extendMarkdownIt` — hooks VS Code's built-in Markdown preview (`Ctrl+Shift+V`) directly.
2. A public API (`activate()`'s return value / `getExtension(...).exports`) that other extensions call host-to-host. This is the primary surface in practice — see "Consumed by `obsidianlike`" below.

## Deploy / test workflow

```sh
npm install
npm run compile        # tsc → out/
npm test               # mocha over out/test/**/*.test.js (pure-logic tests, no vscode dependency)
npm run package         # compile + vsce package --allow-missing-repository → obsidianlike-dataview-0.1.0.vsix
```

To install into the shared "Obsidian like" profile:
```sh
code --profile "Obsidian like" --uninstall-extension angelCastro.obsidianlike-dataview
code --profile "Obsidian like" --install-extension obsidianlike-dataview-0.1.0.vsix
```
(`obsidianlike/make.bat` already does this as one step of its multi-extension deploy chain — see that repo's `CLAUDE.md`.)

Press F5 to launch an Extension Development Host for interactive testing against VS Code's native Markdown preview specifically (the `obsidianlike` custom-editor rendering path can't be exercised this way — that needs `obsidianlike` itself installed in the same host).

## Architecture

| Dir | Role |
|---|---|
| `src/types.ts` | Core value model: `DVValue` (null/bool/number/string/Date/`DVDuration`/`DVLink`/array/object), `DVPage`, `DVTask`. |
| `src/values.ts` | Scalar coercion (YAML/inline-field strings → `DVValue`), comparison, truthiness, rendering to plain text. |
| `src/indexer/parseFile.ts` | **Pure** (no vscode import) markdown → `DVPage` parser: frontmatter (via `gray-matter`), inline `key:: value` fields, `#tags`, `[[wikilinks]]`, nested `- [ ]` tasks. Unit-tested directly. |
| `src/indexer/workspaceIndex.ts` | vscode-dependent: `WorkspaceIndex` scans the workspace via `findFiles`, watches `**/*.md`, keeps an in-memory `Map<path, DVPage>`, computes backlinks, fires `onDidChange`. |
| `src/parser/{lexer,ast,parser}.ts` | Hand-written DQL lexer + recursive-descent/Pratt parser → `Query` AST. `parseQuery` (full query), `parseStandaloneExpr`/`parseSourceString` (fragments, used by tests and `dataviewjs`'s `dv.pages(source)`). |
| `src/engine/{context,evaluator,functions,exprLabel,queryEngine}.ts` | `pageToRecord` builds the identifier-resolution record (`file.*` + frontmatter/inline fields); `evaluate()` walks the `Expr` AST (member/index access **broadcasts over arrays**, Dataview-style, so `rows.file.link` works after `GROUP BY`); `BUILTIN_FUNCTIONS` (~30 functions); `runQuery()` runs FROM-filter → FLATTEN → WHERE → GROUP BY → SORT → LIMIT → per-type row shaping, and never throws — runtime errors become `{ type: 'ERROR', message }`. Note `parseQuery()` itself (parse-time errors) is **not** covered by that catch — callers must wrap it separately (see `extension.ts`'s `runQuery` export). |
| `src/dataviewjs/{api,sandbox}.ts` | `createDataviewJsApi` builds the `dv` object + an `output: DVJsOutputNode[]` sink; `sandbox.ts` runs it in a Node `vm` context with no `require`/`process`. Two entry points: `runDataviewJs` (async, wraps code in an `(async () => {...})()` IIFE, supports top-level `await`, used by the public API/command) and `runDataviewJsSync` (no wrapper, used by the markdown-it renderer since `render()` is synchronous — top-level `await` there throws a SyntaxError, caught and surfaced as an error message). |
| `src/render/html.ts` | `renderQueryResultHtml(QueryResult)` / `renderDataviewJsOutputHtml(DVJsOutputNode[])` → HTML strings. **Links use `<a class="dv-link" href="#" data-wiki="...">`, not a `command:` URI** — see "Consumed by `obsidianlike`" below for why. |
| `src/render/markdownIt.ts` | `registerDataviewMarkdownIt` overrides markdown-it's `fence` rule for VS Code's native preview. |
| `src/blocks.ts` | `findDataviewBlocks(text)` — plain-text fence scanner (not markdown-it) used by the public API and the "Show Query Result for Block at Cursor" command. |
| `src/extension.ts` | `activate()` wires the index, commands, `extendMarkdownIt` export, and returns `ObsidianlikeDataviewApi`. |

## Gotchas

- **Lexer identifiers are Unicode-aware, not ASCII-only**: `DQLLexer`'s identifier rules in `src/parser/lexer.ts` use `\p{L}`/`\p{N}` (Unicode letter/number property escapes with the `u` flag), not `[A-Za-z0-9_]`. This matters because column/field names in Spanish-language vaults routinely contain accented letters (`Área`, `Posición`, `Vertical`) — with a plain ASCII character class, an accented letter silently falls through the lexer's "unknown character: skip it" branch instead of erroring, splitting one identifier into two tokens and producing a confusing downstream `DQLParseError` (e.g. "Unexpected token ... at position N") pointing at the letter *after* the accented one, not the accented one itself. If you touch the lexer's character classes, keep them Unicode-aware or this class of bug comes back.
- **`vm` cross-realm objects**: array/object *literals* written inside a `dataviewjs` block are constructed using the `vm` context's own realm intrinsics, not the host's — `Array.isArray()`/iteration/`.map()` all still work (spec-guaranteed, realm-independent), but `instanceof Array` (host-side) and `assert.deepStrictEqual` (prototype-sensitive) do not. Values returned by `dv.*` functions themselves (`dv.list`, `dv.table`, `dv.fileLink`, ...) are fine either way — those functions are *defined* in `api.ts` (host realm), and a function's `[[Call]]` always runs in its defining realm regardless of who invokes it, so anything they construct (`new DVLink(...)`, `new Date()` via the injected host `Date`) is a real host-realm instance.
- **Parse errors vs. runtime errors**: `runQuery()` (the engine function) catches only evaluation-time throws. A malformed query string throws `DQLParseError` synchronously out of `parseQuery()`, *before* `runQuery()` is ever called — every call site that accepts raw query text (the public API's `runQuery`, the markdown-it renderer, the "Show Query Result" command) wraps `parseQuery()` in its own `try/catch`. Don't assume the engine's internal error handling covers a caller that skips this.
- **DataviewJS sync vs. async**: `runDataviewJsSync` cannot support top-level `await` (the code runs unwrapped, not inside an async function) — this is a deliberate limitation of the markdown-it preview path only, not a bug. The public API's `runDataviewJs` (used by `obsidianlike` and the "Show Query Result" command) is async and does support it.
- **`data-wiki` is a contract, not a type**: `renderQueryResultHtml`'s link markup (`data-wiki="<path-without-.md>"`) exists specifically to plug into `obsidianlike`'s generic `[data-wiki]` click handler. There's no shared type or compile-time check between the two repos — if this markup changes, update `obsidianlike/webview-src/editor.js`'s CSS (`.cm-dataview-query .dv-*`) and confirm links still navigate.

## Consumed by `obsidianlike` (soft dependency, host-to-host)

`obsidianlike` (repo `c:\git\obsidianlike`, extension id `angelCastro.obsidian-like`) renders ```dataview```/```dql```/```dataviewjs``` blocks inside its own CodeMirror-based custom editor — a webview, **not** VS Code's built-in Markdown preview — so `extendMarkdownIt` never runs there. Instead its extension host resolves this extension via `vscode.extensions.getExtension('angelCastro.obsidianlike-dataview')?.activate()` (no `extensionDependencies` entry — optional on both sides), calls `runQuery`/`runDataviewJs`, and forwards the resulting HTML (`renderQueryResultHtml`/`renderDataviewJsOutputHtml`) to its webview over `postMessage`. See `obsidianlike/CLAUDE.md`'s "Dataview query blocks" sections (both the extension-host and `livePreviewPlugin`/webview ones) for the full round-trip, cache/effect mechanism, and CSS.

Two things that only make sense in light of that integration:
- Link markup is `data-wiki`, not `command:` (see Gotchas above) — a plain custom-editor webview has no built-in `command:` URI handling.
- `TASK`-type results render checkboxes as plain `disabled <input>` — there's no task-mutation method on this extension's public API (read/query only), so `obsidianlike` can't offer interactive toggling for these the way it does for its own sibling Tasks extension's ```tasks``` blocks.
