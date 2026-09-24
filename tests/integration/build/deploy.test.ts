import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deployPlugin } from "../../../scripts/deploy-core.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "nox-deploy-test-"));
}

const silent = {
  log: () => {},
  warn: () => {},
};

test("deploy copies dist and enables Nox without removing existing plugins", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });

  writeFileSync(join(dist, "main.js"), "bundle");
  writeFileSync(join(dist, "styles.css"), "styles");
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(["other-plugin"]),
  );

  const target = deployPlugin({
    targetVault: vault,
    distDir: dist,
    logger: silent,
  });

  assert.equal(
    readFileSync(join(target, "main.js"), "utf8"),
    "bundle",
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(vault, ".obsidian", "community-plugins.json"),
        "utf8",
      ),
    ),
    ["other-plugin", "nox-obsidian"],
  );
});

test("deploy does not duplicate an already-enabled plugin", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(["nox-obsidian"]),
  );

  deployPlugin({
    targetVault: vault,
    distDir: dist,
    logger: silent,
  });

  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(vault, ".obsidian", "community-plugins.json"),
        "utf8",
      ),
    ),
    ["nox-obsidian"],
  );
});

test("invalid community plugin JSON does not block file deployment", () => {
  const root = tempRoot();
  const dist = join(root, "dist");
  const vault = join(root, "vault");
  mkdirSync(dist, { recursive: true });
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  writeFileSync(join(dist, "main.js"), "bundle");
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    "{bad json",
  );

  const target = deployPlugin({
    targetVault: vault,
    distDir: dist,
    logger: silent,
  });

  assert.equal(
    readFileSync(join(target, "main.js"), "utf8"),
    "bundle",
  );
});

test("missing dist fails before touching the vault", () => {
  const root = tempRoot();

  assert.throws(
    () =>
      deployPlugin({
        targetVault: join(root, "vault"),
        distDir: join(root, "missing"),
        logger: silent,
      }),
    /dist\/ directory not found/,
  );
});
