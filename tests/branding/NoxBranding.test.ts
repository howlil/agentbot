import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const legacyProductName = ["For", "ge"].join("");
const legacyPrefix = ["for", "ge"].join("");

function collectFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];

  return readdirSync(path).flatMap((entry) =>
    collectFiles(join(path, entry)),
  );
}

test("repository product surfaces use Nox branding", () => {
  const roots = [
    "src",
    ".agents",
    "AGENTS.md",
    "DESIGN.md",
    "manifest.json",
    "package.json",
    "styles.css",
    "esbuild.config.mjs",
    "scripts",
  ];

  const files = roots.flatMap(collectFiles);

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    assert.equal(
      content.includes(legacyProductName),
      false,
      `legacy product name remains in ${file}`,
    );
    assert.equal(
      content.includes(`${legacyPrefix}-`),
      false,
      `legacy product prefix remains in ${file}`,
    );
  }
});
