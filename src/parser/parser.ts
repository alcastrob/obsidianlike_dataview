import { DQLLexer, Token } from "./lexer";
import { BinaryOp, Expr, FlattenClause, OrderTerm, Query, QueryType, Source, TableField } from "./ast";

const CLAUSE_KEYWORDS = new Set(["FROM", "WHERE", "SORT", "GROUP", "LIMIT", "FLATTEN"]);
const QUERY_TYPES = new Set(["LIST", "TABLE", "TASK", "CALENDAR"]);

export class DQLParseError extends Error {}

class TokenStream {
  private idx = 0;
  constructor(private readonly tokens: Token[]) {}

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.idx + offset, this.tokens.length - 1)];
  }

  next(): Token {
    const t = this.peek();
    if (t.type !== "eof") this.idx++;
    return t;
  }

  atEof(): boolean {
    return this.peek().type === "eof";
  }

  /** True if the current token is the given identifier, case-insensitively. */
  isIdent(word: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.value.toUpperCase() === word.toUpperCase();
  }

  consumeIdent(word: string): boolean {
    if (this.isIdent(word)) {
      this.next();
      return true;
    }
    return false;
  }

  expectIdent(word: string): void {
    if (!this.consumeIdent(word)) {
      throw new DQLParseError(`Expected "${word}" at position ${this.peek().pos}, got "${this.peek().value}"`);
    }
  }

  isOp(op: string): boolean {
    const t = this.peek();
    return t.type === "op" && t.value === op;
  }

  isPunct(p: string): boolean {
    const t = this.peek();
    return t.type === "punct" && t.value === p;
  }

  consumeOp(op: string): boolean {
    if (this.isOp(op)) {
      this.next();
      return true;
    }
    return false;
  }

  consumePunct(p: string): boolean {
    if (this.isPunct(p)) {
      this.next();
      return true;
    }
    return false;
  }

  expectPunct(p: string): void {
    if (!this.consumePunct(p)) {
      throw new DQLParseError(`Expected "${p}" at position ${this.peek().pos}, got "${this.peek().value}"`);
    }
  }

  isClauseKeyword(): boolean {
    const t = this.peek();
    return t.type === "ident" && CLAUSE_KEYWORDS.has(t.value.toUpperCase());
  }
}

/** Parse a full ```dataview query block (the text inside the fence, without the fence markers). */
export function parseQuery(source: string): Query {
  const tokens = new DQLLexer(source).getTokens();
  const ts = new TokenStream(tokens);

  const typeTok = ts.next();
  if (typeTok.type !== "ident" || !QUERY_TYPES.has(typeTok.value.toUpperCase())) {
    throw new DQLParseError(`Query must start with LIST, TABLE, TASK or CALENDAR, got "${typeTok.value}"`);
  }
  const type = typeTok.value.toUpperCase() as QueryType;

  const query: Query = {
    type,
    withoutId: false,
    fields: [],
    sort: [],
    flatten: [],
  };

  if (type === "TABLE" && ts.consumeIdent("WITHOUT")) {
    ts.expectIdent("ID");
    query.withoutId = true;
  }

  // Field list: for TABLE, comma-separated `expr [AS alias]`; for LIST, a single optional expr.
  if (!ts.isClauseKeyword() && !ts.atEof() && (type === "TABLE" || type === "LIST")) {
    query.fields.push(parseTableField(ts));
    while (ts.consumePunct(",")) {
      query.fields.push(parseTableField(ts));
    }
  }

  while (!ts.atEof()) {
    if (ts.consumeIdent("FROM")) {
      query.from = parseSource(ts);
    } else if (ts.consumeIdent("WHERE")) {
      query.where = parseExpr(ts);
    } else if (ts.isIdent("GROUP")) {
      ts.next();
      ts.expectIdent("BY");
      const expr = parseExpr(ts);
      let alias: string | undefined;
      if (ts.consumeIdent("AS")) alias = parseIdentName(ts);
      query.groupBy = { expr, alias };
    } else if (ts.consumeIdent("SORT")) {
      query.sort.push(parseOrderTerm(ts));
      while (ts.consumePunct(",")) query.sort.push(parseOrderTerm(ts));
    } else if (ts.consumeIdent("LIMIT")) {
      const n = parseExpr(ts);
      if (n.kind !== "number") throw new DQLParseError("LIMIT expects a numeric literal");
      query.limit = n.value;
    } else if (ts.consumeIdent("FLATTEN")) {
      const expr = parseExpr(ts);
      let alias: string | undefined;
      if (ts.consumeIdent("AS")) alias = parseIdentName(ts);
      query.flatten.push({ expr, alias });
    } else {
      throw new DQLParseError(`Unexpected token "${ts.peek().value}" at position ${ts.peek().pos}`);
    }
  }

  return query;
}

function parseIdentName(ts: TokenStream): string {
  const t = ts.next();
  if (t.type !== "ident" && t.type !== "string") {
    throw new DQLParseError(`Expected identifier at position ${t.pos}`);
  }
  return t.value;
}

function parseTableField(ts: TokenStream): TableField {
  const expr = parseExpr(ts);
  let alias: string | undefined;
  if (ts.consumeIdent("AS")) alias = parseIdentName(ts);
  return { expr, alias };
}

function parseOrderTerm(ts: TokenStream): OrderTerm {
  const expr = parseExpr(ts);
  let direction: "ASC" | "DESC" = "ASC";
  if (ts.consumeIdent("ASC") || ts.consumeIdent("ASCENDING")) direction = "ASC";
  else if (ts.consumeIdent("DESC") || ts.consumeIdent("DESCENDING")) direction = "DESC";
  return { expr, direction };
}

// ---- FROM sources ----

function parseSource(ts: TokenStream): Source {
  let left = parseSourceUnary(ts);
  while (ts.isIdent("AND") || ts.isIdent("OR")) {
    const op = ts.next().value.toLowerCase() as "and" | "or";
    const right = parseSourceUnary(ts);
    left = { kind: "binary", op, left, right };
  }
  return left;
}

function parseSourceUnary(ts: TokenStream): Source {
  if (ts.consumeOp("-") || ts.consumeIdent("NOT")) {
    return { kind: "not", source: parseSourceUnary(ts) };
  }
  if (ts.consumePunct("(")) {
    const inner = parseSource(ts);
    ts.expectPunct(")");
    return inner;
  }
  const t = ts.peek();
  if (t.type === "tag") {
    ts.next();
    return { kind: "tag", tag: "#" + t.value };
  }
  if (t.type === "string") {
    ts.next();
    return { kind: "folder", path: t.value };
  }
  if (t.type === "link") {
    ts.next();
    const path = t.value.split("|")[0].split("#")[0].trim();
    return { kind: "link", path, direction: "incoming" };
  }
  throw new DQLParseError(`Expected a source (tag, "folder", or [[link]]) at position ${t.pos}, got "${t.value}"`);
}

// ---- Expressions (Pratt-ish precedence climbing) ----

export function parseExpr(ts: TokenStream): Expr {
  return parseOr(ts);
}

function parseOr(ts: TokenStream): Expr {
  let left = parseAnd(ts);
  while (ts.isIdent("OR")) {
    ts.next();
    left = { kind: "binary", op: "or", left, right: parseAnd(ts) };
  }
  return left;
}

function parseAnd(ts: TokenStream): Expr {
  let left = parseComparison(ts);
  while (ts.isIdent("AND")) {
    ts.next();
    left = { kind: "binary", op: "and", left, right: parseComparison(ts) };
  }
  return left;
}

const COMPARISON_OPS = ["=", "!=", "<=", ">=", "<", ">"];

function parseComparison(ts: TokenStream): Expr {
  let left = parseAdditive(ts);
  for (;;) {
    const t = ts.peek();
    if (t.type === "op" && COMPARISON_OPS.includes(t.value)) {
      ts.next();
      left = { kind: "binary", op: t.value as BinaryOp, left, right: parseAdditive(ts) };
      continue;
    }
    if (ts.isIdent("CONTAINS")) {
      ts.next();
      left = { kind: "binary", op: "contains", left, right: parseAdditive(ts) };
      continue;
    }
    if (ts.isIdent("IN")) {
      ts.next();
      left = { kind: "binary", op: "in", left, right: parseAdditive(ts) };
      continue;
    }
    break;
  }
  return left;
}

function parseAdditive(ts: TokenStream): Expr {
  let left = parseMultiplicative(ts);
  while (ts.isOp("+") || ts.isOp("-")) {
    const op = ts.next().value as BinaryOp;
    left = { kind: "binary", op, left, right: parseMultiplicative(ts) };
  }
  return left;
}

function parseMultiplicative(ts: TokenStream): Expr {
  let left = parseUnary(ts);
  while (ts.isOp("*") || ts.isOp("/") || ts.isOp("%")) {
    const op = ts.next().value as BinaryOp;
    left = { kind: "binary", op, left, right: parseUnary(ts) };
  }
  return left;
}

function parseUnary(ts: TokenStream): Expr {
  if (ts.isOp("-")) {
    ts.next();
    return { kind: "unary", op: "-", expr: parseUnary(ts) };
  }
  if (ts.isOp("!") || ts.isIdent("NOT")) {
    ts.next();
    return { kind: "unary", op: "!", expr: parseUnary(ts) };
  }
  return parsePostfix(ts);
}

function parsePostfix(ts: TokenStream): Expr {
  let expr = parsePrimary(ts);
  for (;;) {
    if (ts.consumePunct(".")) {
      const name = parseIdentName(ts);
      expr = { kind: "member", target: expr, property: name };
      continue;
    }
    if (ts.consumePunct("[")) {
      const idx = parseExpr(ts);
      ts.expectPunct("]");
      expr = { kind: "index", target: expr, index: idx };
      continue;
    }
    break;
  }
  return expr;
}

function parsePrimary(ts: TokenStream): Expr {
  const t = ts.peek();

  if (t.type === "number") {
    ts.next();
    return { kind: "number", value: parseFloat(t.value) };
  }
  if (t.type === "string") {
    ts.next();
    return { kind: "string", value: t.value };
  }
  if (t.type === "tag") {
    ts.next();
    return { kind: "tag", name: "#" + t.value };
  }
  if (t.type === "link") {
    ts.next();
    const [pathPart, display] = t.value.split("|");
    const [pth, subpath] = pathPart.split("#");
    return { kind: "link", path: pth.trim(), subpath: subpath?.trim(), display: display?.trim() };
  }
  if (t.type === "punct" && t.value === "(") {
    ts.next();
    const inner = parseExpr(ts);
    ts.expectPunct(")");
    return inner;
  }
  if (t.type === "punct" && t.value === "[") {
    ts.next();
    const items: Expr[] = [];
    if (!ts.isPunct("]")) {
      items.push(parseExpr(ts));
      while (ts.consumePunct(",")) items.push(parseExpr(ts));
    }
    ts.expectPunct("]");
    return { kind: "list", items };
  }
  if (t.type === "punct" && t.value === "{") {
    ts.next();
    const entries: Array<{ key: string; value: Expr }> = [];
    if (!ts.isPunct("}")) {
      entries.push(parseObjectEntry(ts));
      while (ts.consumePunct(",")) entries.push(parseObjectEntry(ts));
    }
    ts.expectPunct("}");
    return { kind: "object", entries };
  }
  if (t.type === "ident") {
    const upper = t.value.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") {
      ts.next();
      return { kind: "bool", value: upper === "TRUE" };
    }
    if (upper === "NULL") {
      ts.next();
      return { kind: "null" };
    }
    ts.next();
    if (ts.isPunct("(")) {
      ts.next();
      const args: Expr[] = [];
      if (!ts.isPunct(")")) {
        args.push(parseExpr(ts));
        while (ts.consumePunct(",")) args.push(parseExpr(ts));
      }
      ts.expectPunct(")");
      return { kind: "call", name: t.value, args };
    }
    return { kind: "ident", name: t.value };
  }

  throw new DQLParseError(`Unexpected token "${t.value}" at position ${t.pos}`);
}

function parseObjectEntry(ts: TokenStream): { key: string; value: Expr } {
  const t = ts.next();
  const key = t.type === "string" ? t.value : t.value;
  ts.expectPunct(":");
  const value = parseExpr(ts);
  return { key, value };
}

/** Parse a bare expression string (used e.g. by GROUP BY/WHERE fragments in tests). */
export function parseStandaloneExpr(source: string): Expr {
  const tokens = new DQLLexer(source).getTokens();
  const ts = new TokenStream(tokens);
  const expr = parseExpr(ts);
  if (!ts.atEof()) throw new DQLParseError(`Unexpected trailing input at position ${ts.peek().pos}`);
  return expr;
}

/** Parse a bare FROM-source string, e.g. `#tag and "folder"` (used by dv.pages() in DataviewJS). */
export function parseSourceString(source: string): Source {
  const tokens = new DQLLexer(source).getTokens();
  const ts = new TokenStream(tokens);
  const src = parseSource(ts);
  if (!ts.atEof()) throw new DQLParseError(`Unexpected trailing input at position ${ts.peek().pos}`);
  return src;
}
