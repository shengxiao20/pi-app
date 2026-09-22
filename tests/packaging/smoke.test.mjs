import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();

test("rebuilds Tauri's embedded frontend assets whenever Vite updates desktop/dist", () => {
  const buildScript = readFileSync(
    join(repositoryRoot, "desktop", "src-tauri", "build.rs"),
    "utf8",
  );

  assert.match(
    buildScript,
    /track_frontend_assets\(Path::new\("\.\.\/dist"\)\)/,
    "Tauri must re-embed Vite assets after desktop/dist changes",
  );
});

test("packs a clean-installable root package with its current-platform desktop binary", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pi-app-pack-"));
  let tarball;
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
    tarball = join(repositoryRoot, packResult[0].filename);
    const contents = packResult[0].files.map((file) => file.path);

    assert.equal(packResult[0].name, "pi-native-app");
    assert.deepEqual(contents.sort(), [
      "LICENSE",
      "README.md",
      "dist/launcher/index.d.ts",
      "dist/launcher/index.js",
      "extensions/app.ts",
      "node_modules/pi-native-app-darwin-arm64/Pi App.app/Contents/Info.plist",
      "node_modules/pi-native-app-darwin-arm64/Pi App.app/Contents/MacOS/pi-app-desktop",
      "node_modules/pi-native-app-darwin-arm64/Pi App.app/Contents/Resources/icon.icns",
      "node_modules/pi-native-app-darwin-arm64/Pi App.app/Contents/_CodeSignature/CodeResources",
      "node_modules/pi-native-app-darwin-arm64/bin/pi-native-app",
      "node_modules/pi-native-app-darwin-arm64/package.json",
      "package.json",
    ]);
    const viteHtml = readFileSync(
      join(repositoryRoot, "desktop", "dist", "index.html"),
      "utf8",
    );
    const viteScript = viteHtml.match(/src="([^\"]+)"/)?.[1];
    assert.ok(viteScript, "Vite index.html must reference a JavaScript entry");
    const packageExecutable = join(
      repositoryRoot,
      "packages",
      "pi-native-app-darwin-arm64",
      "Pi App.app",
      "Contents",
      "MacOS",
      "pi-app-desktop",
    );
    assert.ok(
      readFileSync(packageExecutable).includes(Buffer.from(viteScript)),
      "the packaged executable must embed Vite's current JavaScript entry",
    );
    assert.doesNotThrow(() =>
      execFileSync("codesign", [
        "--verify",
        "--deep",
        "--strict",
        join(
          repositoryRoot,
          "packages",
          "pi-native-app-darwin-arm64",
          "Pi App.app",
        ),
      ]),
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
      "pi-native-app",
      "node_modules",
      "pi-native-app-darwin-arm64",
      "bin",
      "pi-native-app",
    );
    assert.ok(existsSync(binary));
    const appBundle = join(
      workspace,
      "node_modules",
      "pi-native-app",
      "node_modules",
      "pi-native-app-darwin-arm64",
      "Pi App.app",
    );
    const installedExecutable = join(
      appBundle,
      "Contents",
      "MacOS",
      "pi-app-desktop",
    );
    assert.ok(existsSync(installedExecutable));
    assert.ok(
      readFileSync(installedExecutable).includes(Buffer.from(viteScript)),
      "the clean-installed executable must embed Vite's current JavaScript entry",
    );
    assert.doesNotThrow(() =>
      execFileSync("codesign", ["--verify", "--deep", "--strict", appBundle]),
    );

    const launchResult = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `import { launchDesktopClient } from ${JSON.stringify(
          join(
            workspace,
            "node_modules",
            "pi-native-app",
            "dist",
            "launcher",
            "index.js",
          ),
        )};\nconst binary = launchDesktopClient({ cwd: ${JSON.stringify(workspace)}, spawn: (command) => ({ unref() { console.log(command); } }) });\nconsole.log(binary);`,
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
        "node_modules/pi-native-app",
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
    if (tarball) rmSync(tarball, { force: true });
  }
});
