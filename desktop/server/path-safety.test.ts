import { describe, expect, it } from "vitest";
import { isPathInside } from "./path-safety.ts";

describe("isPathInside", () => {
  it("accepts the root and its descendants on POSIX", () => {
    expect(isPathInside("/app/dist", "/app/dist", "linux")).toBe(true);
    expect(
      isPathInside("/app/dist", "/app/dist/assets/index.js", "linux"),
    ).toBe(true);
  });

  it.each(["/app", "/app-other", "/app/dist-old/index.js"])(
    "rejects POSIX paths outside the root: %s",
    (candidate) => {
      expect(isPathInside("/app/dist", candidate, "linux")).toBe(false);
    },
  );

  it("accepts the root and descendants on Windows", () => {
    expect(isPathInside("C:\\app\\dist", "C:\\app\\dist", "win32")).toBe(true);
    expect(
      isPathInside("C:\\app\\dist", "C:\\app\\dist\\assets\\index.js", "win32"),
    ).toBe(true);
  });

  it.each(["C:\\app", "C:\\app-other\\index.js", "D:\\Windows\\win.ini"])(
    "rejects Windows paths outside the root: %s",
    (candidate) => {
      expect(isPathInside("C:\\app\\dist", candidate, "win32")).toBe(false);
    },
  );
});
