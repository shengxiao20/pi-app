import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("desktop layout", () => {
  it("styles the rename control as an icon button", () => {
    expect(styles).toMatch(/\.rename-session\s*\{[^}]*height:\s*25px/s);
    expect(styles).toMatch(/\.rename-session svg\s*\{[^}]*width:\s*14px/s);
  });

  it("styles the composer action as a right-aligned icon button", () => {
    expect(styles).toMatch(
      /\.composer-footer\s*\{[^}]*justify-content:\s*flex-end/s,
    );
    expect(styles).toMatch(
      /\.composer-action\s*\{[^}]*height:\s*32px[^}]*width:\s*32px/s,
    );
    expect(styles).toMatch(
      /\.composer-action svg\s*\{[^}]*fill:\s*currentColor/s,
    );
  });

  it("styles slash-command completion as a selectable listbox", () => {
    expect(styles).toMatch(
      /\.slash-commands\s*\{[^}]*max-height:\s*200px[^}]*overflow-y:\s*auto/s,
    );
    expect(styles).toMatch(
      /\.slash-commands \[aria-selected="true"\] button,[\s\S]*?background:\s*#e4e9ec/s,
    );
  });

  it("styles the tool visibility toggle as a pressed control", () => {
    expect(styles).toMatch(
      /\.tool-visibility-toggle\s*\{[^}]*cursor:\s*pointer[^}]*padding:\s*7px 10px/s,
    );
    expect(styles).toMatch(
      /\.tool-visibility-toggle\[aria-pressed="true"\]\s*\{[^}]*background:\s*#dfe7eb/s,
    );
  });

  it("styles the explicit older-history control", () => {
    expect(styles).toMatch(
      /\.load-older-history\s*\{[^}]*cursor:\s*pointer[^}]*margin:\s*0 auto 18px/s,
    );
  });

  it("styles an ellipsized target beside each tool invocation", () => {
    expect(styles).toMatch(
      /\.tool summary code\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
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
