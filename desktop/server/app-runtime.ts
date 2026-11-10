import { posix, win32 } from "node:path";

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
