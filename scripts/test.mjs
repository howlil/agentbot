import { build } from "esbuild";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const dir = mkdtempSync(join(tmpdir(), "forge-tests-"));
const outfile = join(dir, "tests.mjs");

try {
  await build({
    entryPoints: ["tests/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    logLevel: "silent",
  });

  const run = spawnSync(process.execPath, ["--test", outfile], {
    stdio: "inherit",
  });

  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
