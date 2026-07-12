import * as assert from "assert";
import { findDataviewBlocks } from "../blocks";

describe("findDataviewBlocks", () => {
  it("finds a dataview block and ignores regular code fences", () => {
    const text = [
      "# Notes",
      "```js",
      "const x = 1;",
      "```",
      "```dataview",
      "LIST FROM #project",
      "```",
      "more text",
    ].join("\n");
    const blocks = findDataviewBlocks(text);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].lang, "dataview");
    assert.strictEqual(blocks[0].query, "LIST FROM #project");
  });

  it("finds dql and dataviewjs blocks", () => {
    const text = ["```dql", "TASK", "```", "```dataviewjs", "dv.list([1,2,3])", "```"].join("\n");
    const blocks = findDataviewBlocks(text);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].lang, "dql");
    assert.strictEqual(blocks[1].lang, "dataviewjs");
  });
});
