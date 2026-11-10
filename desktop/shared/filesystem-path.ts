export function isAbsoluteFileSystemPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[a-z]:[\\/]/i.test(path) ||
    /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(path)
  );
}
