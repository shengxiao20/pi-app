import { execFileSync } from "node:child_process";
import { platform } from "node:os";

const bundleArguments =
  platform() === "darwin" ? ["--bundles", "app"] : ["--no-bundle"];

execFileSync(
  "npm",
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
  { stdio: "inherit" },
);
