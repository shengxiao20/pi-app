import mermaid from "mermaid";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readme = readFileSync(join(process.cwd(), "..", "README.md"), "utf8");
const diagrams = [...readme.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map(
  ([, source], index) => ({ index: index + 1, source }),
);

mermaid.initialize({ startOnLoad: false });

describe("README Mermaid diagrams", () => {
  it("contains the documented event sequence", () => {
    expect(diagrams.length).toBeGreaterThan(0);
    expect(
      diagrams.some(({ source }) => source.includes("sequenceDiagram")),
    ).toBe(true);
  });

  it.each(diagrams)(
    "parses diagram $index with the installed Mermaid parser",
    async ({ source }) => {
      await expect(mermaid.parse(source)).resolves.toEqual(
        expect.objectContaining({ diagramType: "sequence" }),
      );
    },
  );
});
