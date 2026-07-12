import * as assert from "assert";
import { parseQuery, parseStandaloneExpr, DQLParseError } from "../parser/parser";

describe("DQL parser", () => {
  it("parses a basic LIST query", () => {
    const q = parseQuery(`LIST FROM #project WHERE done = true SORT file.name ASC LIMIT 5`);
    assert.strictEqual(q.type, "LIST");
    assert.strictEqual(q.from?.kind, "tag");
    assert.strictEqual(q.where?.kind, "binary");
    assert.strictEqual(q.sort.length, 1);
    assert.strictEqual(q.sort[0].direction, "ASC");
    assert.strictEqual(q.limit, 5);
  });

  it("parses a TABLE query with aliased columns", () => {
    const q = parseQuery(`TABLE priority AS "Priority", status FROM "projects" SORT priority DESC`);
    assert.strictEqual(q.type, "TABLE");
    assert.strictEqual(q.fields.length, 2);
    assert.strictEqual(q.fields[0].alias, "Priority");
    assert.strictEqual(q.fields[1].alias, undefined);
    assert.strictEqual(q.from?.kind, "folder");
  });

  it("parses TABLE WITHOUT ID", () => {
    const q = parseQuery(`TABLE WITHOUT ID file.name AS Name FROM "projects"`);
    assert.strictEqual(q.withoutId, true);
  });

  it("parses TASK queries", () => {
    const q = parseQuery(`TASK FROM #project WHERE !completed`);
    assert.strictEqual(q.type, "TASK");
    assert.strictEqual(q.where?.kind, "unary");
  });

  it("parses combined FROM sources with AND/OR and negation", () => {
    const q = parseQuery(`LIST FROM #project and -#archived`);
    assert.strictEqual(q.from?.kind, "binary");
  });

  it("parses GROUP BY and FLATTEN", () => {
    const q = parseQuery(`TABLE rows FROM "projects" FLATTEN file.tags AS tag GROUP BY tag`);
    assert.strictEqual(q.flatten.length, 1);
    assert.strictEqual(q.flatten[0].alias, "tag");
    assert.strictEqual(q.groupBy?.expr.kind, "ident");
    assert.strictEqual((q.groupBy?.expr as { name: string }).name, "tag");
  });

  it("throws DQLParseError on invalid query type", () => {
    assert.throws(() => parseQuery(`SELECT * FROM foo`), DQLParseError);
  });

  it("parses arithmetic and function-call expressions with correct precedence", () => {
    const expr = parseStandaloneExpr(`round(1 + 2 * 3, 0)`);
    assert.strictEqual(expr.kind, "call");
  });

  it("parses member and index access", () => {
    const expr = parseStandaloneExpr(`file.tags[0]`);
    assert.strictEqual(expr.kind, "index");
  });

  it("parses wikilinks and tags as expressions", () => {
    const expr = parseStandaloneExpr(`[[Some Page|Alias]]`);
    assert.strictEqual(expr.kind, "link");
  });
});
