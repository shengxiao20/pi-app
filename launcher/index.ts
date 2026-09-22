import { existsSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const platformPackages = {
  "darwin-arm64": "pi-app-darwin-arm64",
  "darwin-x64": "pi-app-darwin-x64",
  "linux-x64": "pi-app-linux-x64-gnu",
  "win32-x64": "pi-app-win32-x64-msvc",
} as const;

type SupportedPlatform = keyof typeof platformPackages;

type Spawn = (
  command: string,
  args: string[],
  options: { cwd: string; detached: boolean; stdio: "ignore" },
) => { unref(): void };

export type PlatformPackageName = (typeof platformPackages)[SupportedPlatform];

export interface ResolveDesktopBinaryOptions {
  platform: string;
  arch: string;
  packageRoot: string;
}

export interface LaunchDesktopClientOptions {
  cwd: string;
  sessionFile: string;
  platform?: string;
  arch?: string;
  packageRoot?: string;
  spawn?: Spawn;
}

export function resolvePlatformPackageName(
  platform: string,
  arch: string,
): PlatformPackageName {
  const target = `${platform}-${arch}`;
  const packageName = platformPackages[target as SupportedPlatform];

  if (!packageName) {
    throw new Error(`Unsupported Pi App desktop platform: ${target}`);
  }

  return packageName;
}

export function resolveDesktopBinary({
  platform,
  arch,
  packageRoot,
}: ResolveDesktopBinaryOptions): string {
  const packageName = resolvePlatformPackageName(platform, arch);
  const executableName = platform === "win32" ? "pi-app.exe" : "pi-app";
  const binaryPath = join(
    packageRoot,
    "node_modules",
    packageName,
    "bin",
    executableName,
  );

  if (!existsSync(binaryPath)) {
    throw new Error(`Pi App desktop binary is missing: ${binaryPath}`);
  }

  return binaryPath;
}

export function launchDesktopClient({
  platform = process.platform,
  arch = process.arch,
  packageRoot = fileURLToPath(new URL("../..", import.meta.url)),
  cwd,
  sessionFile,
  spawn = nodeSpawn,
}: LaunchDesktopClientOptions): string {
  const binaryPath = resolveDesktopBinary({ platform, arch, packageRoot });
  const child = spawn(binaryPath, ["--pi-session-file", sessionFile], {
    cwd,
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  return binaryPath;
}
