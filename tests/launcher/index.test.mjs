import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  launchDesktopClient,
  resolveDesktopBinary,
  resolvePlatformPackageName,
} from "../../launcher/index.ts";

test("resolves every supported operating system and architecture to its platform package", () => {
  assert.equal(
    resolvePlatformPackageName("darwin", "arm64"),
    "pi-app-darwin-arm64",
  );
  assert.equal(
    resolvePlatformPackageName("darwin", "x64"),
    "pi-app-darwin-x64",
  );
  assert.equal(
    resolvePlatformPackageName("linux", "x64"),
    "pi-app-linux-x64-gnu",
  );
  assert.equal(
    resolvePlatformPackageName("win32", "x64"),
    "pi-app-win32-x64-msvc",
  );
});

test("rejects unsupported operating systems and architectures explicitly", () => {
  assert.throws(
    () => resolvePlatformPackageName("linux", "arm64"),
    /Unsupported Pi App desktop platform: linux-arm64/,
  );
  assert.throws(
    () => resolvePlatformPackageName("freebsd", "x64"),
    /Unsupported Pi App desktop platform: freebsd-x64/,
  );
});

test("resolves the platform package binary and rejects a missing binary explicitly", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "pi-app-launcher-"));
  const binaryPath = join(
    packageRoot,
    "node_modules",
    "pi-app-darwin-arm64",
    "bin",
    "pi-app",
  );
  mkdirSync(join(packageRoot, "node_modules", "pi-app-darwin-arm64", "bin"), {
    recursive: true,
  });
  writeFileSync(binaryPath, "desktop binary");

  assert.equal(
    resolveDesktopBinary({ platform: "darwin", arch: "arm64", packageRoot }),
    binaryPath,
  );
  assert.throws(
    () => resolveDesktopBinary({ platform: "linux", arch: "x64", packageRoot }),
    /Pi App desktop binary is missing: .*pi-app-linux-x64-gnu\/bin\/pi-app/,
  );
});

test("starts the resolved desktop binary detached in the caller working directory", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "pi-app-launcher-"));
  const cwd = join(packageRoot, "project");
  const binaryPath = join(
    packageRoot,
    "node_modules",
    "pi-app-win32-x64-msvc",
    "bin",
    "pi-app.exe",
  );
  mkdirSync(join(packageRoot, "project"));
  mkdirSync(join(packageRoot, "node_modules", "pi-app-win32-x64-msvc", "bin"), {
    recursive: true,
  });
  writeFileSync(binaryPath, "desktop binary");

  let spawnCall;
  let unrefCalls = 0;

  const launchedPath = launchDesktopClient({
    platform: "win32",
    arch: "x64",
    packageRoot,
    cwd,
    spawn(command, args, options) {
      spawnCall = { command, args, options };
      return { unref: () => unrefCalls++ };
    },
  });

  assert.equal(launchedPath, binaryPath);
  assert.deepEqual(spawnCall, {
    command: binaryPath,
    args: [],
    options: { cwd, detached: true, stdio: "ignore" },
  });
  assert.equal(unrefCalls, 1);
});
