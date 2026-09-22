import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configuration = JSON.parse(
  await readFile(
    new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url),
  ),
);
const stylesheet = await readFile(
  new URL("../desktop/src/styles.css", import.meta.url),
  "utf8",
);

test("desktop opens at a VS Code-sized workspace and fills its WebView", () => {
  const [window] = configuration.app.windows;

  assert.equal(window.width, 1440);
  assert.equal(window.height, 900);
  assert.match(stylesheet, /html,\s*body,\s*#root\s*\{\s*height:\s*100%;/);
  assert.match(
    stylesheet,
    /\.app-shell\s*\{[\s\S]*?inset:\s*0;[\s\S]*?position:\s*fixed;/,
  );
  assert.match(
    stylesheet,
    /\.conversation\s*\{[\s\S]*?grid-row:\s*3;[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.match(stylesheet, /\.composer\s*\{[\s\S]*?grid-row:\s*4;/);
  assert.match(
    stylesheet,
    /\.workspace-navigation\s*\{[\s\S]*?flex:\s*1;[\s\S]*?grid-template-rows:\s*auto auto minmax\(0, 1fr\);/,
  );
  assert.match(
    stylesheet,
    /\.recents\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/,
  );
  const sessionList = stylesheet.match(/\.session-list\s*\{([^}]*)\}/)?.[1];
  assert.match(sessionList, /min-height:\s*0;/);
  assert.match(sessionList, /overflow-y:\s*auto;/);
  assert.doesNotMatch(sessionList, /max-height:/);
  assert.match(
    stylesheet,
    /\.message > div > strong\s*\{[\s\S]*?font-size:\s*10px;/,
  );
  assert.doesNotMatch(stylesheet, /\.message strong\s*\{/);
  assert.doesNotMatch(
    stylesheet,
    /\.(project-create|project-list|project-item)\b/,
  );
  assert.doesNotMatch(stylesheet, /\.sidebar-footer\s*\{/);
  assert.match(stylesheet, /\.markdown code\s*\{[\s\S]*?font:\s*inherit;/);
  assert.match(
    stylesheet,
    /\.markdown pre\s*\{[\s\S]*?font:\s*14px\/1\.6 "SFMono-Regular"/,
  );
  assert.doesNotMatch(
    stylesheet,
    /@media \(max-width: 700px\)[\s\S]*?\.app-shell\s*\{[\s\S]*?height:\s*auto;/,
  );
});
