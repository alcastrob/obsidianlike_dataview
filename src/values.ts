import { DVDuration, DVLink, DVValue } from "./types";

const WIKILINK_RE = /^\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]$/;
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(years?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

function unitToMillis(amount: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("year")) return amount * 365 * 24 * 3600 * 1000;
  if (u.startsWith("month")) return amount * 30 * 24 * 3600 * 1000;
  if (u.startsWith("week")) return amount * 7 * 24 * 3600 * 1000;
  if (u.startsWith("day")) return amount * 24 * 3600 * 1000;
  if (u.startsWith("hour") || u.startsWith("hr")) return amount * 3600 * 1000;
  if (u.startsWith("min")) return amount * 60 * 1000;
  return amount * 1000;
}

/** Parse a raw scalar string (from YAML frontmatter or an inline field) into a typed DVValue. */
export function coerceScalar(raw: string): DVValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;

  const wikilink = WIKILINK_RE.exec(trimmed);
  if (wikilink) {
    const [, path, subpath, display] = wikilink;
    return new DVLink(path.trim(), display?.trim(), subpath?.trim());
  }

  const durationMatch = DURATION_RE.exec(trimmed);
  if (durationMatch) {
    return new DVDuration(unitToMillis(parseFloat(durationMatch[1]), durationMatch[2]));
  }

  if (DATE_RE.test(trimmed)) {
    const d = new Date(trimmed.replace(" ", "T"));
    if (!isNaN(d.getTime())) return d;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!isNaN(n)) return n;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return splitTopLevel(inner, ",").map((s) => coerceScalar(s.trim()));
  }

  return trimmed;
}

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inQuote: string | null = null;
  for (const ch of input) {
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}

/** Recursively convert a value coming out of YAML (via gray-matter/js-yaml) into DVValue types. */
export function coerceFromYaml(value: unknown): DVValue {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(coerceFromYaml);
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const out: Record<string, DVValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = coerceFromYaml(v);
    }
    return out;
  }
  if (typeof value === "string") return coerceScalar(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function isDVLink(v: unknown): v is DVLink {
  return v instanceof DVLink;
}

export function isDVDuration(v: unknown): v is DVDuration {
  return v instanceof DVDuration;
}

export function valueTypeName(v: DVValue): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Date) return "date";
  if (isDVDuration(v)) return "duration";
  if (isDVLink(v)) return "link";
  if (typeof v === "object") return "object";
  return typeof v;
}

/** Render a DVValue as a human-readable string (used by renderers). */
export function renderValue(v: DVValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  if (isDVDuration(v)) return v.toString();
  if (isDVLink(v)) return v.display ?? v.path;
  if (Array.isArray(v)) return v.map(renderValue).join(", ");
  return Object.entries(v)
    .map(([k, val]) => `${k}: ${renderValue(val)}`)
    .join(", ");
}

/** Compare two DVValues for sorting purposes (Dataview-like ordering across types). */
export function compareValues(a: DVValue, b: DVValue): number {
  const ta = valueTypeName(a);
  const tb = valueTypeName(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a === null) return 0;
  switch (ta) {
    case "boolean":
      return (a as boolean) === (b as boolean) ? 0 : a ? 1 : -1;
    case "number":
      return (a as number) - (b as number);
    case "string":
      return (a as string).localeCompare(b as string);
    case "date":
      return (a as Date).getTime() - (b as Date).getTime();
    case "duration":
      return (a as DVDuration).millis - (b as DVDuration).millis;
    case "link":
      return (a as DVLink).path.localeCompare((b as DVLink).path);
    case "array": {
      const aa = a as DVValue[];
      const bb = b as DVValue[];
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        const c = compareValues(aa[i], bb[i]);
        if (c !== 0) return c;
      }
      return aa.length - bb.length;
    }
    default:
      return renderValue(a).localeCompare(renderValue(b));
  }
}

export function isTruthy(v: DVValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return true;
  if (isDVDuration(v)) return v.millis !== 0;
  if (isDVLink(v)) return true;
  return Object.keys(v).length > 0;
}
