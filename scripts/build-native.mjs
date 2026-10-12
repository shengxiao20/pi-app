import { execFileSync } from "node:child_process";
import { platform } from "node:os";

const npmCommand = platform() === "win32" ? "npm.cmd" : "npm";
const bundleArguments =
  platform() === "darwin" ? ["--bundles", "app"] : ["--no-bundle"];

execFileSync(
  npmCommand,
  [
    "exec",
    "--yes",
    "@tauri-apps/cli",
    "--",
    "build",
    ...bundleArguments,
    "--config",
    "desktop/src-tauri/tauri.conf.json",
  ],
  { shell: platform() === "win32", stdio: "inherit" },
);
