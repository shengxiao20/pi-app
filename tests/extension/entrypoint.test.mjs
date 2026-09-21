import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const appExtensionPath = fileURLToPath(new URL("../../extensions/app.ts", import.meta.url));
const pi = process.env.PI_BIN ?? "pi";

function runPi(args, input) {
  return spawnSync(pi, args, {
    cwd: projectRoot,
    encoding: "utf8",
    input,
  });
}

test("the package declares its /app extension", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

  assert.deepEqual(manifest.pi.extensions, ["./extensions"]);
});

test("the package exposes /app through Pi's extension command registry", () => {
  const result = runPi(
    ["--mode", "rpc", "--no-session", "--no-context-files", "--no-extensions", "-e", "."],
    '{"type":"get_commands"}\n',
  );

  assert.equal(result.status, 0, result.stderr);

  const response = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((message) => message.type === "response" && message.command === "get_commands");

  assert.ok(response, result.stdout);
  assert.deepEqual(
    response.data.commands.find((command) => command.name === "app"),
    {
      name: "app",
      description: "Launch the Pi App desktop client",
      source: "extension",
      sourceInfo: {
        path: appExtensionPath,
        source: "cli",
        scope: "temporary",
        origin: "top-level",
      },
    },
  );
});

test("Pi's top-level CLI command list does not expose app", () => {
  const result = runPi(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^  pi app(?:\s|$)/m);
});
