import { DVLink, DVPage, DVValue } from "../types";
import { renderValue } from "../values";
import { pageToRecord } from "../engine/context";
import { matchesSource } from "../engine/queryEngine";
import { parseSourceString } from "../parser/parser";

export type DVJsOutputNode =
  | { kind: "header"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: DVValue[] }
  | { kind: "table"; headers: string[]; rows: DVValue[][] }
  | { kind: "taskList"; tasks: Array<{ text: string; completed: boolean; path: string }> }
  | { kind: "html"; html: string };

export interface DVJsApi {
  dv: Record<string, unknown>;
  output: DVJsOutputNode[];
}

/** Builds the `dv` object exposed to ```dataviewjs blocks, plus the output sink it writes to. */
export function createDataviewJsApi(allPages: DVPage[], currentPath: string, resolveLinkPath: (raw: string) => string | undefined): DVJsApi {
  const output: DVJsOutputNode[] = [];
  const recordCache = new Map<DVPage, Record<string, DVValue>>();
  const recordOf = (p: DVPage): Record<string, DVValue> => {
    let r = recordCache.get(p);
    if (!r) {
      r = pageToRecord(p);
      recordCache.set(p, r);
    }
    return r;
  };

  const pages = (source?: string): Record<string, DVValue>[] => {
    const filtered = source ? allPages.filter((p) => matchesSource(parseSourceString(source), p, resolveLinkPath)) : allPages;
    return filtered.map(recordOf);
  };

  const page = (path: string): Record<string, DVValue> | undefined => {
    const resolved = resolveLinkPath(path) ?? path;
    const found = allPages.find((p) => p.file.path === resolved);
    return found ? recordOf(found) : undefined;
  };

  const dv: Record<string, unknown> = {
    pages,
    page,
    current: () => page(currentPath),
    pagePaths: (source?: string) => pages(source).map((p) => (p.file as Record<string, DVValue>).path),
    header: (level: number, text: unknown) => output.push({ kind: "header", level, text: String(text) }),
    paragraph: (text: unknown) => output.push({ kind: "paragraph", text: String(text) }),
    span: (text: unknown) => output.push({ kind: "paragraph", text: String(text) }),
    el: (_tag: unknown, text: unknown) => output.push({ kind: "paragraph", text: String(text) }),
    list: (items: DVValue[]) => output.push({ kind: "list", items: items ?? [] }),
    table: (headers: string[], rows: DVValue[][]) => output.push({ kind: "table", headers: headers ?? [], rows: rows ?? [] }),
    taskList: (tasks: Array<{ text: string; completed: boolean; path: string }>) =>
      output.push({ kind: "taskList", tasks: (tasks ?? []).map((t) => ({ text: String(t.text), completed: !!t.completed, path: String(t.path ?? "") })) }),
    array: (v: unknown) => (Array.isArray(v) ? v : [v]),
    date: (v: unknown) => (v === undefined ? new Date() : new Date(String(v))),
    duration: (v: unknown) => v,
    fileLink: (path: string, display?: string) => new DVLink(resolveLinkPath(path) ?? path, display),
    renderValue,
  };

  return { dv, output };
}
