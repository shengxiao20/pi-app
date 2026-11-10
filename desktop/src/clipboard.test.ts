import { describe, expect, it } from "vitest";
import { insertClipboardPaths } from "./clipboard";

describe("clipboard path insertion", () => {
  it.each([
    ["", 0, 0, "/tmp/image.png", 14],
    ["Explain", 7, 7, "Explain /tmp/image.png", 22],
    ["Explain ", 8, 8, "Explain /tmp/image.png", 22],
    ["Look:old here", 5, 8, "Look: /tmp/image.png here", 20],
    ["ab", 1, 1, "a /tmp/image.png b", 17],
    ["\n", 0, 0, "/tmp/image.png\n", 14],
  ] satisfies [string, number, number, string, number][])(
    "inserts at the selection in %j",
    (text, start, end, expected, cursor) => {
      expect(
        insertClipboardPaths(text, start, end, ["/tmp/image.png"]),
      ).toEqual({ text: expected, cursor });
    },
  );

  it("preserves paths containing spaces and clipboard order", () => {
    expect(
      insertClipboardPaths("", 0, 0, ["/tmp/a b.png", "/tmp/c.png"]).text,
    ).toBe("/tmp/a b.png /tmp/c.png");
  });

  it("inserts Windows paths without changing their separators", () => {
    const path = "C:\\Users\\I042866\\AppData\\Local\\Temp\\image.png";
    expect(insertClipboardPaths("", 0, 0, [path])).toEqual({
      text: path,
      cursor: path.length,
    });
  });

  it.each(
    [
      [],
      ["relative.png"],
      ["C:relative.png"],
      ["/tmp/a\nb.png"],
      ["/tmp/a\0b.png"],
    ].map((paths) => ({ paths })),
  )("rejects invalid paths %j", ({ paths }) => {
    expect(() => insertClipboardPaths("", 0, 0, paths)).toThrow(
      "absolute paths without control characters",
    );
  });
});
