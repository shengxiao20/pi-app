import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("desktop layout", () => {
  it("styles the rename control as an icon button", () => {
    expect(styles).toMatch(/\.rename-session\s*\{[^}]*height:\s*25px/s);
    expect(styles).toMatch(/\.rename-session svg\s*\{[^}]*width:\s*14px/s);
  });

  it("keeps the composer in a shrinkable viewport and adapts to narrow displays", () => {
    expect(styles).toMatch(
      /\.app-shell\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*min-height:\s*0/s);
    expect(styles).toMatch(
      /@media \(max-width: 700px\)\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*38vh\) minmax\(0,\s*1fr\)/,
    );
    expect(styles).toMatch(/@media \(max-height: 760px\)/);
  });
});
