import { accessSync, readFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { pathToFileURL } from "node:url";

export type LaunchCommand = {
  file: string;
  args: string[];
};

export function serverEntryPath(
  extensionPath: string,
  sourcePath: string,
  bundlePath: string,
  platform: string,
): string {
  const paths = platform === "win32" ? win32 : posix;
  const segments = paths.resolve(extensionPath).split(paths.sep);
  return segments.includes("node_modules") ? bundlePath : sourcePath;
}

export function piSdkEntryUrl(
  packageDir: string,
  entryPoint: string,
  platform: string,
): string {
  const paths = platform === "win32" ? win32 : posix;
  return pathToFileURL(paths.join(packageDir, entryPoint), {
    windows: platform === "win32",
  }).href;
}

export function hostPiSdkUrl(packageDir: string): string {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  ) as { exports: { ".": { import: string } } };
  const sdkUrl = piSdkEntryUrl(
    packageDir,
    manifest.exports["."].import,
    process.platform,
  );
  // Fail before spawning the detached server if the host SDK is unavailable.
  accessSync(new URL(sdkUrl));
  return sdkUrl;
}

export function nodeServerArgs(serverPath: string): string[] {
  return serverPath.endsWith(".ts")
    ? ["--experimental-strip-types", serverPath]
    : [serverPath];
}

export function browserLaunchCommand(
  platform: string,
  url: string,
): LaunchCommand {
  if (platform === "darwin") return { file: "open", args: [url] };
  if (platform === "win32") {
    return { file: "cmd.exe", args: ["/d", "/c", "start", "", url] };
  }
  return { file: "xdg-open", args: [url] };
}
