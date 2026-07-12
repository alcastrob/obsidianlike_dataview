import * as vscode from "vscode";
import { DVLink, DVPage } from "../types";
import { parseMarkdownFile } from "./parseFile";

function toRelPath(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  return rel.replace(/\\/g, "/");
}

/** Resolve a link target (as typed in `[[...]]`) against the index, Obsidian-style: match by
 *  full path, or by filename if unambiguous. */
export function resolveLinkPath(index: Map<string, DVPage>, rawTarget: string): string | undefined {
  const target = rawTarget.replace(/\\/g, "/").replace(/\.md$/i, "");
  if (index.has(target + ".md")) return target + ".md";
  const bare = target.split("/").pop()!;
  for (const key of index.keys()) {
    const name = key.replace(/\.md$/i, "").split("/").pop()!;
    if (name === bare) return key;
  }
  return undefined;
}

/** Maintains an in-memory index of every markdown file in the workspace, kept up to date via a
 *  FileSystemWatcher. This is the data source the DQL/DataviewJS query engine reads from. */
export class WorkspaceIndex implements vscode.Disposable {
  private pages = new Map<string, DVPage>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private pendingReindex: NodeJS.Timeout | undefined;

  constructor(private readonly getConfig: () => { include: string[]; exclude: string[] }) {}

  async initialize(): Promise<void> {
    await this.reindexAll();
    this.watcher = vscode.workspace.createFileSystemWatcher("**/*.md");
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange((uri) => this.reindexFile(uri)),
      this.watcher.onDidCreate((uri) => this.reindexFile(uri)),
      this.watcher.onDidDelete((uri) => this.removeFile(uri))
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChange.dispose();
    if (this.pendingReindex) clearTimeout(this.pendingReindex);
  }

  getAllPages(): DVPage[] {
    return [...this.pages.values()];
  }

  getPage(relPath: string): DVPage | undefined {
    return this.pages.get(relPath);
  }

  resolveLinkPath(rawTarget: string): string | undefined {
    return resolveLinkPath(this.pages, rawTarget);
  }

  get size(): number {
    return this.pages.size;
  }

  async reindexAll(): Promise<void> {
    const { include, exclude } = this.getConfig();
    const excludePattern = exclude.length ? `{${exclude.join(",")}}` : undefined;
    const includePattern = include.length === 1 ? include[0] : `{${include.join(",")}}`;
    const uris = await vscode.workspace.findFiles(includePattern, excludePattern);

    const newPages = new Map<string, DVPage>();
    for (const uri of uris) {
      const page = await this.readAndParse(uri);
      if (page) newPages.set(page.file.path, page);
    }
    this.pages = newPages;
    this.computeBacklinks();
    this._onDidChange.fire();
  }

  private async reindexFile(uri: vscode.Uri): Promise<void> {
    const page = await this.readAndParse(uri);
    if (page) this.pages.set(page.file.path, page);
    this.scheduleBacklinkRecompute();
  }

  private removeFile(uri: vscode.Uri): void {
    this.pages.delete(toRelPath(uri));
    this.scheduleBacklinkRecompute();
  }

  private scheduleBacklinkRecompute(): void {
    if (this.pendingReindex) clearTimeout(this.pendingReindex);
    this.pendingReindex = setTimeout(() => {
      this.computeBacklinks();
      this._onDidChange.fire();
    }, 250);
  }

  private computeBacklinks(): void {
    for (const page of this.pages.values()) page.file.inlinks = [];
    for (const page of this.pages.values()) {
      for (const link of page.file.outlinks) {
        const resolved = resolveLinkPath(this.pages, link.path);
        if (resolved) {
          const target = this.pages.get(resolved)!;
          target.file.inlinks.push(new DVLink(page.file.path, page.file.name));
        }
      }
    }
  }

  private async readAndParse(uri: vscode.Uri): Promise<DVPage | undefined> {
    try {
      const [stat, bytes] = await Promise.all([vscode.workspace.fs.stat(uri), vscode.workspace.fs.readFile(uri)]);
      const content = Buffer.from(bytes).toString("utf8");
      return parseMarkdownFile({
        relPath: toRelPath(uri),
        content,
        ctime: new Date(stat.ctime),
        mtime: new Date(stat.mtime),
        size: stat.size,
      });
    } catch {
      return undefined;
    }
  }
}
