import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();

test("packs a clean-installable root package with its current-platform desktop binary", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pi-app-pack-"));
  try {
    execFileSync("npm", ["run", "prepack"], {
      cwd: repositoryRoot,
      stdio: "pipe",
    });
    const packResult = JSON.parse(
      execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
    );
    const tarball = join(repositoryRoot, packResult[0].filename);
    const contents = packResult[0].files.map((file) => file.path);

    assert.ok(contents.includes("extensions/app.ts"));
    assert.ok(contents.includes("dist/launcher/index.js"));
    assert.ok(
      contents.includes(
        "node_modules/pi-app-darwin-arm64/Pi App.app/Contents/MacOS/pi-app-desktop",
      ),
    );

    execFileSync("npm", ["install", "--ignore-scripts", tarball], {
      cwd: workspace,
      stdio: "pipe",
    });

    const packageName = `${platform()}-${arch()}`;
    assert.equal(packageName, "darwin-arm64");
    const binary = join(
      workspace,
      "node_modules",
      "pi-app",
      "node_modules",
      "pi-app-darwin-arm64",
      "bin",
      "pi-app",
    );
    assert.ok(existsSync(binary));
    assert.ok(
      existsSync(
        join(
          workspace,
          "node_modules",
          "pi-app",
          "node_modules",
          "pi-app-darwin-arm64",
          "Pi App.app",
          "Contents",
          "MacOS",
          "pi-app-desktop",
        ),
      ),
    );

    const launchResult = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `import { launchDesktopClient } from ${JSON.stringify(join(workspace, "node_modules", "pi-app", "dist", "launcher", "index.js"))};\nconst binary = launchDesktopClient({ cwd: ${JSON.stringify(workspace)}, spawn: (command) => ({ unref() { console.log(command); } }) });\nconsole.log(binary);`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(launchResult.trim().split("\n").at(-1), realpathSync(binary));

    const commands = execFileSync(
      process.env.PI_BIN ?? "pi",
      [
        "--mode",
        "rpc",
        "--no-session",
        "--no-context-files",
        "--no-extensions",
        "-e",
        "node_modules/pi-app",
      ],
      { cwd: workspace, input: '{"type":"get_commands"}\n', encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find(
        (record) =>
          record.type === "response" && record.command === "get_commands",
      );
    assert.ok(commands.data.commands.some((command) => command.name === "app"));
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});
