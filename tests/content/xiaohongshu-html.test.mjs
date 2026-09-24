import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const documentPath = "/Users/I604724/Documents/Obsidian Vault/pi-native-app-xiaohongshu.html";

test("Xiaohongshu copy is a self-contained mobile paged HTML document", () => {
  assert.ok(existsSync(documentPath), "the Xiaohongshu HTML document exists");

  const document = readFileSync(documentPath, "utf8");
  assert.match(document, /<meta name="viewport"/);
  assert.match(document, /<svg[\s>]/);
  assert.equal((document.match(/class="page/g) ?? []).length, 9);
  assert.match(document, /\/app → extension → launcher/);
  assert.match(document, /最后 80 条/);
  assert.match(document, /extension_ui_request/);
});
