import * as vm from "vm";
import { DVPage } from "../types";
import { createDataviewJsApi, DVJsOutputNode } from "./api";

export interface DataviewJsResult {
  ok: boolean;
  output: DVJsOutputNode[];
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 2000;

function buildContext(allPages: DVPage[], currentPath: string, resolveLinkPath: (raw: string) => string | undefined) {
  const { dv, output } = createDataviewJsApi(allPages, currentPath, resolveLinkPath);
  const logs: string[] = [];
  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
  };
  const sandbox: Record<string, unknown> = {
    dv,
    console: sandboxConsole,
    Math,
    JSON,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
  };
  return { context: vm.createContext(sandbox), output, logs };
}

/**
 * Runs a ```dataviewjs block in a Node `vm` context with a minimal `dv` API and no access to
 * `require`/`process`/the filesystem. `vm` is not a hard security boundary against a determined
 * attacker, but it keeps well-behaved scripts from touching anything outside the sandbox object,
 * which matches the trust model of Dataview's own dataviewjs feature (opt-in, same-workspace code).
 * Supports top-level `await`; use `runDataviewJsSync` where a synchronous result is required.
 */
export async function runDataviewJs(
  code: string,
  allPages: DVPage[],
  currentPath: string,
  resolveLinkPath: (raw: string) => string | undefined
): Promise<DataviewJsResult> {
  const { context, output } = buildContext(allPages, currentPath, resolveLinkPath);
  const wrapped = `(async () => {\n${code}\n})()`;

  try {
    const script = new vm.Script(wrapped, { filename: currentPath || "dataviewjs-block.js" });
    const resultPromise: Promise<unknown> = script.runInContext(context, { timeout: DEFAULT_TIMEOUT_MS });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("dataviewjs block timed out")), DEFAULT_TIMEOUT_MS));
    await Promise.race([resultPromise, timeout]);
    return { ok: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output, error: message };
  }
}

/**
 * Synchronous variant used by the Markdown preview renderer (markdown-it's `render` is not
 * async-aware). Runs the block body directly rather than wrapping it in an async IIFE, so
 * top-level `await` is not supported here — synchronous scripts (the common case: loops that
 * call dv.table/dv.list/dv.header) work fine.
 */
export function runDataviewJsSync(
  code: string,
  allPages: DVPage[],
  currentPath: string,
  resolveLinkPath: (raw: string) => string | undefined
): DataviewJsResult {
  const { context, output } = buildContext(allPages, currentPath, resolveLinkPath);

  try {
    const script = new vm.Script(code, { filename: currentPath || "dataviewjs-block.js" });
    script.runInContext(context, { timeout: DEFAULT_TIMEOUT_MS });
    return { ok: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output, error: message };
  }
}
