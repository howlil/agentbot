import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { PolicyLoader } from "../../src/context/PolicyLoader";

test("returns empty policy when AGENTS.md is missing", async () => {
  const loader = new PolicyLoader({
    vault: {
      getFileByPath: () => null,
    },
  } as never);

  assert.deepEqual(await loader.load(), {
    path: "AGENTS.md",
    rawInstructions: "",
  });
});

test("caches policy by mtime and reloads when it changes", async () => {
  const file = new TFile("AGENTS.md", { mtime: 1 });
  let reads = 0;
  let content = "first";

  const loader = new PolicyLoader({
    vault: {
      getFileByPath: () => file,
      cachedRead: async () => {
        reads += 1;
        return content;
      },
    },
  } as never);

  assert.equal((await loader.load()).rawInstructions, "first");
  assert.equal((await loader.load()).rawInstructions, "first");
  assert.equal(reads, 1);

  file.stat.mtime = 2;
  content = "second";

  assert.equal((await loader.load()).rawInstructions, "second");
  assert.equal(reads, 2);
});
