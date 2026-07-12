import { Expr } from "../parser/ast";
import { DVDuration, DVLink, DVValue } from "../types";
import { compareValues, isDVDuration, isDVLink, isTruthy } from "../values";
import { BUILTIN_FUNCTIONS, DQLRuntimeError } from "./functions";

export interface EvalScope {
  record: Record<string, DVValue>;
  /** Resolve an unresolved [[Link]] literal's display page path, if it needs normalizing. */
  resolveLinkPath?: (raw: string) => string;
}

export function evaluate(expr: Expr, scope: EvalScope): DVValue {
  switch (expr.kind) {
    case "null":
      return null;
    case "bool":
      return expr.value;
    case "number":
      return expr.value;
    case "string":
      return expr.value;
    case "tag":
      return expr.name;
    case "link": {
      const path = scope.resolveLinkPath ? scope.resolveLinkPath(expr.path) : expr.path;
      return new DVLink(path, expr.display, expr.subpath);
    }
    case "ident":
      return resolveIdent(expr.name, scope.record);
    case "list":
      return expr.items.map((it) => evaluate(it, scope));
    case "object": {
      const obj: Record<string, DVValue> = {};
      for (const entry of expr.entries) obj[entry.key] = evaluate(entry.value, scope);
      return obj;
    }
    case "unary": {
      const v = evaluate(expr.expr, scope);
      if (expr.op === "-") return -toNumber(v);
      return !isTruthy(v);
    }
    case "binary":
      return evaluateBinary(expr.op, expr.left, expr.right, scope);
    case "member":
      return evaluateMember(evaluate(expr.target, scope), expr.property);
    case "index": {
      const target = evaluate(expr.target, scope);
      const idx = evaluate(expr.index, scope);
      return evaluateIndex(target, idx);
    }
    case "call": {
      const fn = BUILTIN_FUNCTIONS[expr.name.toLowerCase()];
      if (!fn) throw new DQLRuntimeError(`Unknown function "${expr.name}"`);
      const args = expr.args.map((a) => evaluate(a, scope));
      return fn(args);
    }
  }
}

function resolveIdent(name: string, record: Record<string, DVValue>): DVValue {
  if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
  // Dataview normalizes field names to lowercase-with-dashes-as-spaces in some contexts; try a
  // case-insensitive match as a friendlier fallback.
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) return record[key];
  }
  return null;
}

/** Member/index access broadcasts over arrays (Dataview-style vectorized field access), so that
 *  e.g. `rows.file.link` yields a list of links when `rows` is a list of row objects. */
function evaluateMember(target: DVValue, property: string): DVValue {
  if (Array.isArray(target)) return target.map((v) => evaluateMember(v, property));
  if (target === null || target === undefined) return null;
  if (isDVLink(target)) {
    if (property === "path") return target.path;
    if (property === "display") return target.display ?? target.path;
    return null;
  }
  if (isDVDuration(target)) {
    return property === "millis" ? target.millis : null;
  }
  if (target instanceof Date) {
    switch (property) {
      case "year":
        return target.getFullYear();
      case "month":
        return target.getMonth() + 1;
      case "day":
        return target.getDate();
      case "hour":
        return target.getHours();
      case "minute":
        return target.getMinutes();
      default:
        return null;
    }
  }
  if (typeof target === "object") {
    const rec = target as Record<string, DVValue>;
    return Object.prototype.hasOwnProperty.call(rec, property) ? rec[property] : null;
  }
  return null;
}

function evaluateIndex(target: DVValue, idx: DVValue): DVValue {
  if (Array.isArray(target)) {
    if (typeof idx === "number") return target[idx] ?? null;
    return target.map((v) => evaluateIndex(v, idx));
  }
  if (target && typeof target === "object" && !(target instanceof Date) && !isDVLink(target) && !isDVDuration(target)) {
    return evaluateMember(target, String(idx));
  }
  if (typeof target === "string" && typeof idx === "number") return target[idx] ?? null;
  return null;
}

function toNumber(v: DVValue): number {
  if (typeof v === "number") return v;
  if (isDVDuration(v)) return v.millis;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function evaluateBinary(op: string, leftExpr: Expr, rightExpr: Expr, scope: EvalScope): DVValue {
  if (op === "and") {
    const l = evaluate(leftExpr, scope);
    return isTruthy(l) ? evaluate(rightExpr, scope) : l;
  }
  if (op === "or") {
    const l = evaluate(leftExpr, scope);
    return isTruthy(l) ? l : evaluate(rightExpr, scope);
  }

  const left = evaluate(leftExpr, scope);
  const right = evaluate(rightExpr, scope);

  switch (op) {
    case "+":
      if (typeof left === "string" || typeof right === "string") return stringify(left) + stringify(right);
      if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
      if (left instanceof Date && isDVDuration(right)) return new Date(left.getTime() + right.millis);
      if (isDVDuration(left) && isDVDuration(right)) return new DVDuration(left.millis + right.millis);
      return toNumber(left) + toNumber(right);
    case "-":
      if (left instanceof Date && right instanceof Date) return new DVDuration(left.getTime() - right.getTime());
      if (left instanceof Date && isDVDuration(right)) return new Date(left.getTime() - right.millis);
      if (isDVDuration(left) && isDVDuration(right)) return new DVDuration(left.millis - right.millis);
      return toNumber(left) - toNumber(right);
    case "*":
      return toNumber(left) * toNumber(right);
    case "/":
      return toNumber(left) / toNumber(right);
    case "%":
      return toNumber(left) % toNumber(right);
    case "=":
      return compareValues(left, right) === 0;
    case "!=":
      return compareValues(left, right) !== 0;
    case "<":
      return compareValues(left, right) < 0;
    case "<=":
      return compareValues(left, right) <= 0;
    case ">":
      return compareValues(left, right) > 0;
    case ">=":
      return compareValues(left, right) >= 0;
    case "contains":
      return containsValue(left, right);
    case "in":
      return containsValue(right, left);
    default:
      throw new DQLRuntimeError(`Unknown operator "${op}"`);
  }
}

function containsValue(container: DVValue, needle: DVValue): boolean {
  if (Array.isArray(container)) return container.some((v) => compareValues(v, needle) === 0);
  if (typeof container === "string") return container.includes(stringify(needle));
  if (container && typeof container === "object" && !(container instanceof Date) && !isDVLink(container) && !isDVDuration(container)) {
    return Object.prototype.hasOwnProperty.call(container, stringify(needle));
  }
  return false;
}

function stringify(v: DVValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (isDVLink(v)) return v.display ?? v.path;
  return String(v);
}
