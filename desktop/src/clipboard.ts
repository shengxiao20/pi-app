export function insertClipboardPaths(
  text: string,
  start: number,
  end: number,
  paths: string[],
): { text: string; cursor: number } {
  if (
    !paths.length ||
    paths.some((path) => !path.startsWith("/") || /\p{Cc}/u.test(path))
  ) {
    throw new Error(
      "Clipboard images require absolute paths without control characters.",
    );
  }
  const before = text.slice(0, start);
  const after = text.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const insertion = `${prefix}${paths.join(" ")}${suffix}`;
  return {
    text: `${before}${insertion}${after}`,
    cursor: before.length + insertion.length,
  };
}
