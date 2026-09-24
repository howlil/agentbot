import {
  existsSync,
  readFileSync,
} from "fs";

const required = [
  "dist/main.js",
  "dist/styles.css",
  "dist/manifest.json",
  "dist/nox.png",
];

for (const path of required) {
  if (!existsSync(path)) {
    throw new Error(`Missing build artifact: ${path}`);
  }
}

if (existsSync("dist/forge.png")) {
  throw new Error("Legacy brand artifact must not exist: dist/forge.png");
}

const manifest = JSON.parse(
  readFileSync("dist/manifest.json", "utf8"),
);
const pkg = JSON.parse(
  readFileSync("package.json", "utf8"),
);

if (manifest.id !== "nox-obsidian") {
  throw new Error(
    `Unexpected plugin id: ${String(manifest.id)}`,
  );
}

if (manifest.name !== "Nox") {
  throw new Error(
    `Unexpected plugin name: ${String(manifest.name)}`,
  );
}

if (pkg.main !== "dist/main.js") {
  throw new Error(
    `Unexpected package main: ${String(pkg.main)}`,
  );
}

console.log("Nox build artifacts verified.");
