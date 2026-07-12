import * as assert from "assert";
import { runDataviewJsSync, runDataviewJs } from "../dataviewjs/sandbox";
import { parseMarkdownFile } from "../indexer/parseFile";
import { DVPage } from "../types";

function page(relPath: string, content: string): DVPage {
  return parseMarkdownFile({ relPath, content, ctime: new Date(), mtime: new Date(), size: content.length });
}

const pages: DVPage[] = [page("a.md", `---\ntitle: A\n---\nbody`), page("b.md", `---\ntitle: B\n---\nbody`)];
const resolveLinkPath = (raw: string) => pages.find((p) => p.file.path.replace(/\.md$/i, "") === raw)?.file.path ?? raw;

describe("dataviewjs sandbox", () => {
  it("runs synchronous scripts and captures dv.table output", () => {
    const result = runDataviewJsSync(`dv.table(["Name"], dv.pages().map(p => [p.file.name]));`, pages, "", resolveLinkPath);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output.length, 1);
    assert.strictEqual(result.output[0].kind, "table");
  });

  it("reports errors instead of throwing", () => {
    const result = runDataviewJsSync(`throw new Error("boom");`, pages, "", resolveLinkPath);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes("boom"));
  });

  it("has no access to require/process", () => {
    const result = runDataviewJsSync(`dv.paragraph(typeof require + " " + typeof process);`, pages, "", resolveLinkPath);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output[0].kind, "paragraph");
    assert.strictEqual((result.output[0] as { text: string }).text, "undefined undefined");
  });

  it("supports async scripts via runDataviewJs", async () => {
    const result = await runDataviewJs(`await Promise.resolve(); dv.list([1, 2, 3]);`, pages, "", resolveLinkPath);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.output.length, 1);
    // The array literal is constructed inside the vm's own realm, so compare via a host-realm
    // copy rather than assert.deepStrictEqual (which is realm/prototype-sensitive).
    assert.deepStrictEqual(Array.from((result.output[0] as { items: number[] }).items), [1, 2, 3]);
  });
});
