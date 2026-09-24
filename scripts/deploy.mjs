import fs from "fs";
import path from "path";
import { deployPlugin } from "./deploy-core.mjs";

const PLUGIN_ID = "nox-obsidian";

const DEFAULT_VAULTS = [
  path.join(
    process.env.USERPROFILE || "",
    "Documents",
    "howlil",
  ),
];

const targetVault =
  process.argv[2] ||
  process.env.OBSIDIAN_VAULT ||
  DEFAULT_VAULTS.find((vault) =>
    fs.existsSync(path.join(vault, ".obsidian")),
  );

if (!targetVault) {
  console.error(
    "❌ No Obsidian vault found. Please pass your vault path:",
  );
  console.error(
    '   pnpm run deploy "C:\\Path\\To\\Your\\Vault"',
  );
  process.exit(1);
}

try {
  const pluginDest = deployPlugin({
    targetVault,
    distDir: path.resolve("dist"),
    pluginId: PLUGIN_ID,
  });

  console.log(
    `\n🎉 Successfully deployed ${PLUGIN_ID} to:`,
  );
  console.log(`   ${pluginDest}\n`);
} catch (error) {
  console.error(
    "❌",
    error instanceof Error
      ? error.message
      : String(error),
  );
  process.exit(1);
}
