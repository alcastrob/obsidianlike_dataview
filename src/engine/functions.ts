import { DVDuration, DVLink, DVValue } from "../types";
import { coerceScalar, compareValues, isDVDuration, isDVLink, renderValue, valueTypeName } from "../values";

export class DQLRuntimeError extends Error {}

function asNumber(v: DVValue, fn: string): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  throw new DQLRuntimeError(`${fn}() expects a number, got ${valueTypeName(v)}`);
}

function asArray(v: DVValue, fn: string): DVValue[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  throw new DQLRuntimeError(`${fn}() expects a list, got ${valueTypeName(v)}`);
}

function asString(v: DVValue): string {
  return renderValue(v);
}

function numericList(list: DVValue[], fn: string): number[] {
  return list.filter((v) => v !== null && v !== undefined).map((v) => asNumber(v, fn));
}

export type DVFunction = (args: DVValue[]) => DVValue;

export const BUILTIN_FUNCTIONS: Record<string, DVFunction> = {
  length: (args) => {
    const v = args[0];
    if (Array.isArray(v)) return v.length;
    if (typeof v === "string") return v.length;
    if (v && typeof v === "object" && !(v instanceof Date) && !isDVLink(v) && !isDVDuration(v)) {
      return Object.keys(v).length;
    }
    return 0;
  },
  sum: (args) => numericList(asArray(args[0], "sum"), "sum").reduce((a, b) => a + b, 0),
  min: (args) => {
    const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (list.length === 0) return null;
    return list.reduce((a, b) => (compareValues(a, b) <= 0 ? a : b));
  },
  max: (args) => {
    const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (list.length === 0) return null;
    return list.reduce((a, b) => (compareValues(a, b) >= 0 ? a : b));
  },
  average: (args) => {
    const nums = numericList(asArray(args[0], "average"), "average");
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  },
  avg: (args) => BUILTIN_FUNCTIONS.average(args),
  round: (args) => {
    const n = asNumber(args[0], "round");
    const digits = args[1] !== undefined ? asNumber(args[1], "round") : 0;
    const factor = Math.pow(10, digits);
    return Math.round(n * factor) / factor;
  },
  floor: (args) => Math.floor(asNumber(args[0], "floor")),
  ceil: (args) => Math.ceil(asNumber(args[0], "ceil")),
  abs: (args) => Math.abs(asNumber(args[0], "abs")),
  number: (args) => {
    const v = args[0];
    if (typeof v === "number") return v;
    const n = parseFloat(asString(v));
    return isNaN(n) ? null : n;
  },
  string: (args) => asString(args[0]),
  default: (args) => (args[0] === null || args[0] === undefined || args[0] === "" ? args[1] ?? null : args[0]),
  choice: (args) => (args[0] ? args[1] : args[2]),
  list: (args) => args,
  contains: (args) => {
    const [container, needle] = args;
    if (Array.isArray(container)) return container.some((v) => compareValues(v, needle) === 0);
    if (typeof container === "string") return container.includes(asString(needle));
    if (container && typeof container === "object" && !(container instanceof Date) && !isDVLink(container) && !isDVDuration(container)) {
      return Object.prototype.hasOwnProperty.call(container, asString(needle));
    }
    return false;
  },
  reverse: (args) => [...asArray(args[0], "reverse")].reverse(),
  sort: (args) => [...asArray(args[0], "sort")].sort(compareValues),
  unique: (args) => {
    const seen: DVValue[] = [];
    for (const v of asArray(args[0], "unique")) {
      if (!seen.some((s) => compareValues(s, v) === 0)) seen.push(v);
    }
    return seen;
  },
  flat: (args) => asArray(args[0], "flat").flatMap((v) => (Array.isArray(v) ? v : [v])),
  lower: (args) => asString(args[0]).toLowerCase(),
  upper: (args) => asString(args[0]).toUpperCase(),
  trim: (args) => asString(args[0]).trim(),
  join: (args) => asArray(args[0], "join").map(asString).join(args[1] !== undefined ? asString(args[1]) : ", "),
  split: (args) => asString(args[0]).split(args[1] !== undefined ? asString(args[1]) : ","),
  replace: (args) => asString(args[0]).split(asString(args[1])).join(asString(args[2])),
  regexmatch: (args) => new RegExp(asString(args[0])).test(asString(args[1])),
  regexreplace: (args) => asString(args[0]).replace(new RegExp(asString(args[1]), "g"), asString(args[2])),
  striptags: (args) => asString(args[0]).replace(/<[^>]*>/g, ""),
  date: (args) => {
    const v = args[0];
    if (v instanceof Date) return v;
    const coerced = coerceScalar(asString(v));
    return coerced instanceof Date ? coerced : null;
  },
  dur: (args) => {
    const v = args[0];
    if (isDVDuration(v)) return v;
    const coerced = coerceScalar(asString(v));
    return isDVDuration(coerced) ? coerced : null;
  },
  today: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },
  now: () => new Date(),
  link: (args) => new DVLink(asString(args[0]), args[1] !== undefined ? asString(args[1]) : undefined),
  typeof: (args) => valueTypeName(args[0]),
  nonzero: (args) => asArray(args[0], "nonzero").filter((v) => v !== 0 && v !== null),
  all: (args) => asArray(args[0], "all").every((v) => v),
  any: (args) => asArray(args[0], "any").some((v) => v),
};
