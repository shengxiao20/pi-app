import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();

test("defines the cross-platform release workflow", () => {
  const workflow = readFileSync(
    join(repositoryRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /macos-14/);
  assert.match(workflow, /windows-latest/);
  assert.doesNotMatch(workflow, /build-linux|pi-native-app-linux/);
  assert.match(
    workflow,
    /publish_platform pi-native-app-darwin-arm64 \.\/packages\/pi-native-app-darwin-arm64/,
  );
  assert.match(
    workflow,
    /publish_platform pi-native-app-win32-x64-msvc \.\/packages\/pi-native-app-win32-x64-msvc/,
  );
  assert.match(workflow, /npm run build:launcher/);
  assert.match(workflow, /npm publish --ignore-scripts --access public/);
  assert.match(workflow, /Version \$\{RELEASE_VERSION\} is already published/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);

  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /git push origin/);
});

test("keeps platform artifact packages out of npm workspaces", () => {
  const packageManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.deepEqual(packageManifest.workspaces, ["desktop"]);
});

test("declares the Windows x64 native package in the release manifest", () => {
  const packageManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageManifest.optionalDependencies["pi-native-app-win32-x64-msvc"],
    "file:packages/pi-native-app-win32-x64-msvc",
  );
  assert.equal(packageManifest.bundledDependencies, undefined);
  assert.ok(
    !packageManifest.optionalDependencies["pi-native-app-linux-x64-gnu"],
  );
  assert.ok(
    existsSync(
      join(
        repositoryRoot,
        "packages",
        "pi-native-app-win32-x64-msvc",
        "package.json",
      ),
    ),
  );
});

test("runs the Tauri CLI through a Windows command shell", () => {
  const buildScript = readFileSync(
    join(repositoryRoot, "scripts", "build-native.mjs"),
    "utf8",
  );

  assert.match(
    buildScript,
    /const npmCommand = platform\(\) === "win32" \? "npm\.cmd" : "npm"/,
  );
  assert.match(buildScript, /shell:\s*platform\(\) === "win32"/);
});

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

test("publishes a root package that installs its current-platform desktop binary", () => {
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
      "package.json",
    ]);
    const publishedPackage = join(workspace, "published-package");
    execFileSync("tar", ["-xzf", tarball, "-C", workspace]);
    cpSync(join(workspace, "package"), publishedPackage, { recursive: true });
    const publishedManifestPath = join(publishedPackage, "package.json");
    const publishedManifest = JSON.parse(
      readFileSync(publishedManifestPath, "utf8"),
    );
    const platformTarball = join(
      workspace,
      JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            workspace,
          ],
          {
            cwd: join(repositoryRoot, "packages", "pi-native-app-darwin-arm64"),
            encoding: "utf8",
          },
        ),
      )[0].filename,
    );
    publishedManifest.optionalDependencies = {
      "pi-native-app-darwin-arm64": `file:${platformTarball}`,
    };
    writeFileSync(
      publishedManifestPath,
      `${JSON.stringify(publishedManifest, null, 2)}\n`,
    );
    const publishedTarball = JSON.parse(
      execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
        cwd: publishedPackage,
        encoding: "utf8",
      }),
    )[0].filename;
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", join(publishedPackage, publishedTarball)],
      { cwd: workspace, stdio: "pipe" },
    );

    const packageName = `${platform()}-${arch()}`;
    assert.equal(packageName, "darwin-arm64");
    const binary = join(
      workspace,
      "node_modules",
      "pi-native-app-darwin-arm64",
      "bin",
      "pi-native-app",
    );
    assert.ok(existsSync(binary));
    const appBundle = join(
      workspace,
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
