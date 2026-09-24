import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const iconDirectory = join(process.cwd(), "desktop", "src-tauri", "icons");
const pngIcon = join(iconDirectory, "icon.png");
const icnsIcon = join(iconDirectory, "icon.icns");
const svgSource = join(iconDirectory, "icon.svg");

test("packages a Pi-symbol application icon in PNG and ICNS formats", () => {
  assert.ok(existsSync(svgSource));
  assert.match(readFileSync(svgSource, "utf8"), /#e98c78/);
  assert.match(readFileSync(svgSource, "utf8"), /#5a9abf/);
  assert.match(readFileSync(svgSource, "utf8"), /#ecc261/);

  const imageProperties = execFileSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", pngIcon],
    { encoding: "utf8" },
  );
  assert.match(imageProperties, /pixelWidth: 1024/);
  assert.match(imageProperties, /pixelHeight: 1024/);

  const icnsType = execFileSync("file", ["-b", icnsIcon], {
    encoding: "utf8",
  });
  assert.match(icnsType, /^Mac OS X icon/);
});
