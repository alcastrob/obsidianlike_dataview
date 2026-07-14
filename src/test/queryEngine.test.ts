import * as assert from "assert";
import { parseMarkdownFile } from "../indexer/parseFile";
import { parseQuery } from "../parser/parser";
import { runQuery } from "../engine/queryEngine";
import { DVPage } from "../types";

function page(relPath: string, content: string): DVPage {
  return parseMarkdownFile({ relPath, content, ctime: new Date("2024-01-01"), mtime: new Date("2024-01-02"), size: content.length });
}

const pages: DVPage[] = [
  page("projects/alpha.md", `---\ntitle: Alpha\npriority: 2\ntags: [project]\n---\n- [ ] task one\n- [x] task two`),
  page("projects/beta.md", `---\ntitle: Beta\npriority: 5\ntags: [project, urgent]\n---\nLinks to [[projects/alpha]].`),
  page("archive/old.md", `---\ntitle: Old\npriority: 1\ntags: [archived]\n---\nNothing here.`),
];

function resolveLinkPath(raw: string): string | undefined {
  const norm = raw.replace(/\.md$/i, "");
  const found = pages.find((p) => p.file.path.replace(/\.md$/i, "") === norm);
  return found?.file.path;
}

describe("query engine", () => {
  it("runs a LIST query filtered by tag", () => {
    const q = parseQuery(`LIST FROM #project`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "LIST");
    if (result.type === "LIST") assert.strictEqual(result.rows.length, 2);
  });

  it("treats FROM \"/\" as the whole vault, including subfolders", () => {
    const q = parseQuery(`LIST FROM "/"`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "LIST");
    if (result.type === "LIST") assert.strictEqual(result.rows.length, pages.length);
  });

  it("runs a TABLE query with WHERE and SORT", () => {
    const q = parseQuery(`TABLE priority FROM "projects" WHERE priority > 1 SORT priority DESC`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "TABLE");
    if (result.type === "TABLE") {
      assert.deepStrictEqual(result.headers, ["File", "priority"]);
      assert.strictEqual(result.rows.length, 2);
      assert.strictEqual(result.rows[0][1], 5); // beta first (priority 5, DESC)
    }
  });

  it("excludes archived pages via negated tag source", () => {
    const q = parseQuery(`LIST FROM -#archived`);
    const result = runQuery(q, pages, { resolveLinkPath });
    if (result.type === "LIST") assert.strictEqual(result.rows.length, 2);
  });

  it("resolves incoming link sources", () => {
    const q = parseQuery(`LIST FROM [[projects/alpha]]`);
    const result = runQuery(q, pages, { resolveLinkPath });
    // beta.md links to alpha, so it should be the only match.
    if (result.type === "LIST") {
      assert.strictEqual(result.rows.length, 1);
      assert.strictEqual(result.rows[0].link?.path, "projects/beta.md");
    }
  });

  it("runs a plain TASK query as a flat list (no per-file grouping by default)", () => {
    const q = parseQuery(`TASK FROM "projects" WHERE !completed`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "TASK");
    if (result.type === "TASK") {
      assert.strictEqual(result.groups, null);
      assert.strictEqual(result.tasks.length, 1);
      assert.strictEqual(result.tasks[0].text, "task one");
    }
  });

  it("groups a TASK query only when GROUP BY is explicit", () => {
    const q = parseQuery(`TASK FROM "projects" GROUP BY file.link`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "TASK");
    if (result.type === "TASK") {
      assert.notStrictEqual(result.groups, null);
      // alpha.md has 2 tasks, beta.md has none => 1 group
      assert.strictEqual(result.groups?.length, 1);
      assert.strictEqual(result.groups?.[0].tasks.length, 2);
    }
  });

  it("applies GROUP BY and exposes aggregated rows", () => {
    const q = parseQuery(`TABLE sum(rows.priority) AS total GROUP BY file.folder`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "TABLE");
  });

  it("returns an ERROR result for runtime errors instead of throwing", () => {
    const q = parseQuery(`TABLE unknownFn(1) FROM "projects"`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "ERROR");
  });

  it("supports FLATTEN over list fields", () => {
    const q = parseQuery(`TABLE tag FROM "projects" FLATTEN file.tags AS tag`);
    const result = runQuery(q, pages, { resolveLinkPath });
    assert.strictEqual(result.type, "TABLE");
    if (result.type === "TABLE") {
      // alpha has 1 tag, beta has 2 tags => 3 flattened rows total
      assert.strictEqual(result.rows.length, 3);
    }
  });
});
