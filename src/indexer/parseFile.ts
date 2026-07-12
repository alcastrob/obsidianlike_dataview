import * as path from "path";
import matter from "gray-matter";
import { DVFileInfo, DVLink, DVPage, DVTask, DVValue } from "../types";
import { coerceFromYaml, coerceScalar } from "../values";

const TAG_RE = /(^|[\s(])#([A-Za-z][\w/-]*)/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const INLINE_FIELD_LINE_RE = /^\s*(?:[-*]\s*\[[^\]]\]\s*)?(?:[-*]\s+)?([A-Za-z_][\w \t-]*?)::\s*(.*)$/;
const INLINE_FIELD_BRACKET_RE = /[\[(]([A-Za-z_][\w -]*?)::\s*([^\])]*)[\])]/g;
const TASK_LINE_RE = /^(\s*)[-*]\s+\[(.)\]\s+(.*)$/;
const FENCE_RE = /^\s*```/;

export interface ParsedFileInput {
  /** Path relative to the workspace root, using forward slashes. */
  relPath: string;
  content: string;
  ctime: Date;
  mtime: Date;
  size: number;
}

function stripCodeFences(content: string): { stripped: string; codeRanges: Array<[number, number]> } {
  const lines = content.split("\n");
  let inFence = false;
  const outLines: string[] = [];
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      outLines.push("");
      continue;
    }
    outLines.push(inFence ? "" : line);
  }
  return { stripped: outLines.join("\n"), codeRanges: [] };
}

function extractTags(text: string): string[] {
  const tags = new Set<string>();
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    tags.add("#" + m[2]);
  }
  return [...tags];
}

function extractLinks(text: string): DVLink[] {
  const links: DVLink[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(text))) {
    links.push(new DVLink(m[1].trim(), m[3]?.trim(), m[2]?.trim()));
  }
  return links;
}

function extractInlineFields(text: string): Record<string, DVValue> {
  const fields: Record<string, DVValue> = {};
  for (const rawLine of text.split("\n")) {
    const m = INLINE_FIELD_LINE_RE.exec(rawLine);
    if (m) {
      const key = m[1].trim();
      fields[key] = coerceScalar(m[2].trim());
    }
    let bm: RegExpExecArray | null;
    INLINE_FIELD_BRACKET_RE.lastIndex = 0;
    while ((bm = INLINE_FIELD_BRACKET_RE.exec(rawLine))) {
      fields[bm[1].trim()] = coerceScalar(bm[2].trim());
    }
  }
  return fields;
}

function parseTasks(content: string, relPath: string): DVTask[] {
  const lines = content.split("\n");
  const root: DVTask[] = [];
  const stack: Array<{ indent: number; task: DVTask }> = [];

  lines.forEach((line, idx) => {
    const m = TASK_LINE_RE.exec(line);
    if (!m) return;
    const indent = m[1].replace(/\t/g, "    ").length;
    const status = m[2];
    const text = m[3];
    const task: DVTask = {
      text,
      completed: status.toLowerCase() === "x",
      status,
      line: idx,
      path: relPath,
      tags: extractTags(text),
      children: [],
      annotatedFields: extractInlineFields(text),
    };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length === 0) {
      root.push(task);
    } else {
      stack[stack.length - 1].task.children.push(task);
    }
    stack.push({ indent, task });
  });

  return root;
}

function flattenTasks(tasks: DVTask[]): DVTask[] {
  const out: DVTask[] = [];
  const walk = (list: DVTask[]) => {
    for (const t of list) {
      out.push(t);
      walk(t.children);
    }
  };
  walk(tasks);
  return out;
}

/** Parse a single markdown file's raw content into a DVPage. Pure function — no I/O, no vscode dependency. */
export function parseMarkdownFile(input: ParsedFileInput): DVPage {
  const { relPath, content } = input;
  let frontmatter: Record<string, unknown> = {};
  let body = content;
  try {
    const parsed = matter(content);
    frontmatter = parsed.data ?? {};
    body = parsed.content ?? content;
  } catch {
    // Malformed YAML frontmatter: fall back to treating the whole file as body.
    frontmatter = {};
    body = content;
  }

  const { stripped } = stripCodeFences(body);

  const bodyTags = extractTags(stripped);
  const bodyLinks = extractLinks(stripped);
  const inlineFields = extractInlineFields(stripped);
  const tasks = parseTasks(body, relPath);

  const fmTags = normalizeTagField(frontmatter.tags ?? frontmatter.tag);
  const allTags = [...new Set([...fmTags, ...bodyTags])];

  const fields: Record<string, DVValue> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k === "tags" || k === "tag") continue;
    fields[k] = coerceFromYaml(v);
  }
  for (const [k, v] of Object.entries(inlineFields)) {
    fields[k] = v;
  }

  const parsedPath = path.posix.parse(relPath.replace(/\\/g, "/"));

  const file: DVFileInfo = {
    path: relPath,
    name: parsedPath.name,
    folder: parsedPath.dir,
    extension: parsedPath.ext.replace(/^\./, ""),
    ctime: input.ctime,
    mtime: input.mtime,
    size: input.size,
    tags: allTags,
    outlinks: bodyLinks,
    inlinks: [],
    tasks: flattenTasks(tasks),
    frontmatterRaw: frontmatter,
  };

  return { file, fields };
}

function normalizeTagField(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const asArray = Array.isArray(value) ? value : String(value).split(",");
  return asArray
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.startsWith("#") ? t : "#" + t));
}
