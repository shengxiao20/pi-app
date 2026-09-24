import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { arch, platform } from "node:os";
import { join } from "node:path";

const packageNames = {
  "darwin-arm64": "pi-native-app-darwin-arm64",
  "darwin-x64": "pi-native-app-darwin-x64",
  "linux-x64": "pi-native-app-linux-x64-gnu",
  "win32-x64": "pi-native-app-win32-x64-msvc",
};

const target = `${platform()}-${arch()}`;
const packageName = packageNames[target];

if (!packageName) {
  throw new Error(`Unsupported Pi App desktop platform: ${target}`);
}

const packageDirectory = join("packages", packageName);
const binDirectory = join(packageDirectory, "bin");
rmSync(binDirectory, { force: true, recursive: true });
mkdirSync(binDirectory, { recursive: true });

if (platform() === "darwin") {
  const appSource = join(
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle",
    "macos",
    "Pi App.app",
  );
  const appDestination = join(packageDirectory, "Pi App.app");
  if (!existsSync(appSource)) {
    throw new Error(
      `Tauri macOS app bundle is missing: ${appSource}. Run tauri build first.`,
    );
  }
  rmSync(appDestination, { force: true, recursive: true });
  cpSync(appSource, appDestination, { recursive: true });
  execFileSync("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appDestination,
  ]);
  const launcher = join(binDirectory, "pi-native-app");
  writeFileSync(
    launcher,
    '#!/bin/sh\nexec "$(dirname "$0")/../Pi App.app/Contents/MacOS/pi-app-desktop" "$@"\n',
  );
  chmodSync(launcher, 0o755);
  console.error(`Packaged ${appSource} as ${appDestination}`);
} else {
  const executableName =
    platform() === "win32" ? "pi-app-desktop.exe" : "pi-app-desktop";
  const packagedName =
    platform() === "win32" ? "pi-native-app.exe" : "pi-native-app";
  const source = join(
    "desktop",
    "src-tauri",
    "target",
    "release",
    executableName,
  );
  const destination = join(binDirectory, packagedName);
  if (!existsSync(source)) {
    throw new Error(
      `Tauri release binary is missing: ${source}. Run the release build first.`,
    );
  }
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
  console.error(`Packaged ${source} as ${destination}`);
}
