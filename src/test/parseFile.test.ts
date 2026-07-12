import * as assert from "assert";
import { parseMarkdownFile } from "../indexer/parseFile";
import { DVLink } from "../types";

describe("parseMarkdownFile", () => {
  it("parses YAML frontmatter fields", () => {
    const page = parseMarkdownFile({
      relPath: "notes/one.md",
      content: `---\ntitle: Hello World\npriority: 3\ndone: true\n---\nBody text.`,
      ctime: new Date(),
      mtime: new Date(),
      size: 0,
    });
    assert.strictEqual(page.fields.title, "Hello World");
    assert.strictEqual(page.fields.priority, 3);
    assert.strictEqual(page.fields.done, true);
  });

  it("collects frontmatter and inline tags", () => {
    const page = parseMarkdownFile({
      relPath: "notes/two.md",
      content: `---\ntags: [project, urgent]\n---\nSome text with a #inline-tag and #nested/tag.`,
      ctime: new Date(),
      mtime: new Date(),
      size: 0,
    });
    assert.deepStrictEqual(new Set(page.file.tags), new Set(["#project", "#urgent", "#inline-tag", "#nested/tag"]));
  });

  it("parses inline fields written as key:: value", () => {
    const page = parseMarkdownFile({
      relPath: "notes/three.md",
      content: `No frontmatter here.\nstatus:: active\nowner:: Alice`,
      ctime: new Date(),
      mtime: new Date(),
      size: 0,
    });
    assert.strictEqual(page.fields.status, "active");
    assert.strictEqual(page.fields.owner, "Alice");
  });

  it("parses wikilinks as outlinks", () => {
    const page = parseMarkdownFile({
      relPath: "notes/four.md",
      content: `See [[Other Note]] and [[folder/Note2|Alias]].`,
      ctime: new Date(),
      mtime: new Date(),
      size: 0,
    });
    assert.strictEqual(page.file.outlinks.length, 2);
    assert.ok(page.file.outlinks[0] instanceof DVLink);
    assert.strictEqual(page.file.outlinks[0].path, "Other Note");
    assert.strictEqual(page.file.outlinks[1].path, "folder/Note2");
    assert.strictEqual(page.file.outlinks[1].display, "Alias");
  });

  it("parses tasks including nested subtasks", () => {
    const page = parseMarkdownFile({
      relPath: "notes/five.md",
      content: `- [ ] Top task\n  - [x] Done subtask\n- [ ] Another top task #urgent`,
      ctime: new Date(),
      mtime: new Date(),
      size: 0,
    });
    assert.strictEqual(page.file.tasks.length, 3);
    const done = page.file.tasks.find((t) => t.text === "Done subtask");
    assert.ok(done);
    assert.strictEqual(done!.completed, true);
    const urgent = page.file.tasks.find((t) => t.text.includes("Another top task"));
    assert.ok(urgent);
    assert.deepStrictEqual(urgent!.tags, ["#urgent"]);
  });

  it("does not crash on malformed frontmatter", () => {
    const page = parseMarkdownFile({
      relPath: "notes/six.md",
      content: `---\ntitle: [unterminated\n---\nBody`,
      ctime: new Date(),
      mtime: new Date(),
      size: 0,
    });
    assert.ok(page.file);
    assert.strictEqual(page.fields.title, undefined);
  });
});
