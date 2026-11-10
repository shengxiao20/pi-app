import { posix, win32 } from "node:path";

export function isPathInside(
  root: string,
  candidate: string,
  platform: string = process.platform,
): boolean {
  const paths = platform === "win32" ? win32 : posix;
  const relative = paths.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(relative))
  );
}
