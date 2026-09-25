import assert from "node:assert/strict";
import test from "node:test";
import { resolveNoxMarkdownLink } from "../../src/chat/markdown-links";

test("resolves relative Markdown files and headings", () => {
  assert.equal(resolveNoxMarkdownLink("notes%2Fdatabase.md"), "notes/database.md");
  assert.equal(resolveNoxMarkdownLink("database.md#indexes"), "database.md#indexes");
  assert.equal(resolveNoxMarkdownLink("#indexes"), "#indexes");
});

test("strips Markdown aliases before opening the target", () => {
  assert.equal(resolveNoxMarkdownLink("database.md|Database index"), "database.md");
});

test("keeps Obsidian internal links without a .md suffix", () => {
  assert.equal(resolveNoxMarkdownLink("Database index", true), "Database index");
});

test("does not intercept external URLs", () => {
  assert.equal(resolveNoxMarkdownLink("https://example.com/guide.md"), null);
  assert.equal(resolveNoxMarkdownLink("mailto:user@example.com"), null);
});
