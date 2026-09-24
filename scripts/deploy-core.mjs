import fs from "fs";
import path from "path";

export function deployPlugin({
  targetVault,
  distDir,
  pluginId = "nox-obsidian",
  logger = console,
}) {
  if (!fs.existsSync(distDir)) {
    throw new Error(
      "dist/ directory not found. Please run 'pnpm run build' first.",
    );
  }

  const pluginDest = path.join(
    targetVault,
    ".obsidian",
    "plugins",
    pluginId,
  );

  fs.mkdirSync(pluginDest, { recursive: true });

  const files = fs.readdirSync(distDir);
  for (const file of files) {
    const src = path.join(distDir, file);
    const dest = path.join(pluginDest, file);
    fs.copyFileSync(src, dest);
    logger.log(`  ✓ Copied ${file}`);
  }

  const communityPluginsPath = path.join(
    targetVault,
    ".obsidian",
    "community-plugins.json",
  );

  try {
    let plugins = [];
    if (fs.existsSync(communityPluginsPath)) {
      plugins = JSON.parse(
        fs.readFileSync(
          communityPluginsPath,
          "utf-8",
        ),
      );
    }

    if (!Array.isArray(plugins)) {
      throw new Error(
        "community-plugins.json must contain an array.",
      );
    }

    if (!plugins.includes(pluginId)) {
      plugins.push(pluginId);
      fs.mkdirSync(
        path.dirname(communityPluginsPath),
        { recursive: true },
      );
      fs.writeFileSync(
        communityPluginsPath,
        JSON.stringify(plugins, null, 2),
        "utf-8",
      );
      logger.log(
        `  ✓ Added '${pluginId}' to community-plugins.json`,
      );
    }
  } catch (error) {
    logger.warn(
      "  ⚠ Could not auto-enable in community-plugins.json:",
      error instanceof Error
        ? error.message
        : String(error),
    );
  }

  return pluginDest;
}
