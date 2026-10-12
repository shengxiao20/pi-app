import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();
const releaseVersion = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
).version;

const readJsonVersion = (path) =>
  JSON.parse(readFileSync(join(repositoryRoot, path), "utf8")).version;

const readTextVersion = (path, pattern) => {
  const match = pattern.exec(readFileSync(join(repositoryRoot, path), "utf8"));
  assert.ok(match, `Expected a version in ${path}`);
  return match[1];
};

test("release metadata and documentation declare one consistent version", () => {
  const versions = [
    readJsonVersion("package.json"),
    readJsonVersion("desktop/package.json"),
    readJsonVersion("desktop/src-tauri/tauri.conf.json"),
    readJsonVersion("packages/pi-native-app-darwin-arm64/package.json"),
    readJsonVersion("packages/pi-native-app-win32-x64-msvc/package.json"),
    readTextVersion("desktop/src-tauri/Cargo.toml", /^version = "([^"]+)"/m),
    readTextVersion("README.md", /Current release: \*\*([^*]+)\*\*/),
  ];

  assert.deepEqual(versions, Array(versions.length).fill(releaseVersion));

  const packageManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );
  assert.match(
    packageManifest.optionalDependencies["pi-native-app-win32-x64-msvc"],
    /^(?:file:|\d+\.\d+\.\d+)/,
  );
  assert.ok(
    packageManifest.bundledDependencies.includes(
      "pi-native-app-win32-x64-msvc",
    ),
  );

  const windowsPackage = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "packages/pi-native-app-win32-x64-msvc/package.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(windowsPackage.os, ["win32"]);
  assert.deepEqual(windowsPackage.cpu, ["x64"]);
  assert.ok(windowsPackage.files.includes("bin/pi-native-app.exe"));

  const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
  assert.match(readme, /Windows x64/);
  assert.doesNotMatch(readme, /macOS on Apple Silicon \(`darwin-arm64`\) only/);
});
