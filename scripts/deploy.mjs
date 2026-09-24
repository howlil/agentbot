import fs from "fs";
import path from "path";

const PLUGIN_ID = "nox-obsidian";

// Known default vault paths (ordered by recent usage)
const DEFAULT_VAULTS = [
  path.join(process.env.USERPROFILE || "", "Documents", "howlil"),
];

// Target vault from CLI argument, env var, or existing default vaults
const targetVault =
  process.argv[2] ||
  process.env.OBSIDIAN_VAULT ||
  DEFAULT_VAULTS.find((v) => fs.existsSync(path.join(v, ".obsidian")));

if (!targetVault) {
  console.error("❌ No Obsidian vault found. Please pass your vault path:");
  console.error("   pnpm run deploy \"C:\\Path\\To\\Your\\Vault\"");
  process.exit(1);
}

const pluginDest = path.join(targetVault, ".obsidian", "plugins", PLUGIN_ID);
const distDir = path.resolve("dist");

if (!fs.existsSync(distDir)) {
  console.error("❌ dist/ directory not found. Please run 'pnpm run build' first.");
  process.exit(1);
}

// 1. Create target plugin directory
fs.mkdirSync(pluginDest, { recursive: true });

// 2. Copy all files from dist/ to plugin directory
const files = fs.readdirSync(distDir);
for (const file of files) {
  const src = path.join(distDir, file);
  const dest = path.join(pluginDest, file);
  fs.copyFileSync(src, dest);
  console.log(`  ✓ Copied ${file}`);
}

// 3. Ensure plugin is enabled in community-plugins.json
const communityPluginsPath = path.join(targetVault, ".obsidian", "community-plugins.json");
try {
  let plugins = [];
  if (fs.existsSync(communityPluginsPath)) {
    plugins = JSON.parse(fs.readFileSync(communityPluginsPath, "utf-8"));
  }
  if (!plugins.includes(PLUGIN_ID)) {
    plugins.push(PLUGIN_ID);
    fs.writeFileSync(communityPluginsPath, JSON.stringify(plugins, null, 2), "utf-8");
    console.log(`  ✓ Added '${PLUGIN_ID}' to community-plugins.json`);
  }
} catch (err) {
  console.warn("  ⚠ Could not auto-enable in community-plugins.json:", err.message);
}

console.log(`\n🎉 Successfully deployed ${PLUGIN_ID} to:`);
console.log(`   ${pluginDest}\n`);
