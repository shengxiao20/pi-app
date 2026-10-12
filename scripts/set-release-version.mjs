import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: node scripts/set-release-version.mjs <semver>");
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const jsonFiles = [
  "package.json",
  "desktop/package.json",
  "desktop/src-tauri/tauri.conf.json",
  "packages/pi-native-app-darwin-arm64/package.json",
  "packages/pi-native-app-win32-x64-msvc/package.json",
];

for (const relativePath of jsonFiles) {
  const path = resolve(repositoryRoot, relativePath);
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.version = version;
  if (relativePath === "package.json") {
    value.optionalDependencies["pi-native-app-darwin-arm64"] =
      `file:packages/pi-native-app-darwin-arm64`;
    value.optionalDependencies["pi-native-app-win32-x64-msvc"] =
      `file:packages/pi-native-app-win32-x64-msvc`;
  }
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const cargoPath = resolve(repositoryRoot, "desktop/src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version = "[^"]+"/m,
  `version = "${version}"`,
);
writeFileSync(cargoPath, cargo);

const readmePath = resolve(repositoryRoot, "README.md");
const readme = readFileSync(readmePath, "utf8").replace(
  /Current release: \*\*[^*]+\*\*/,
  `Current release: **${version}**`,
);
writeFileSync(readmePath, readme);
