// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  browserLaunchCommand,
  hostPiSdkUrl,
  nodeServerArgs,
  piSdkEntryUrl,
  serverEntryPath,
} from "./app-runtime.ts";

const serverSource = "/project/desktop/server/index.ts";
const serverBundle = "/project/desktop/server-build/index.js";

describe("extension runtime paths", () => {
  it("uses the built JavaScript server for an npm install on Windows", () => {
    expect(
      serverEntryPath(
        "C:\\Users\\I042866\\.pi\\agent\\npm\\node_modules\\pi-native-app\\extensions\\app.ts",
        "C:\\Users\\I042866\\.pi\\agent\\npm\\node_modules\\pi-native-app\\desktop\\server\\index.ts",
        "C:\\Users\\I042866\\.pi\\agent\\npm\\node_modules\\pi-native-app\\desktop\\server-build\\index.js",
        "win32",
      ),
    ).toBe(
      "C:\\Users\\I042866\\.pi\\agent\\npm\\node_modules\\pi-native-app\\desktop\\server-build\\index.js",
    );
  });

  it("uses source TypeScript for a local Windows package path", () => {
    expect(
      serverEntryPath(
        "C:\\src\\pi-app\\extensions\\app.ts",
        "C:\\src\\pi-app\\desktop\\server\\index.ts",
        "C:\\src\\pi-app\\desktop\\server-build\\index.js",
        "win32",
      ),
    ).toBe("C:\\src\\pi-app\\desktop\\server\\index.ts");
  });

  it("uses source TypeScript for a local POSIX package path", () => {
    expect(
      serverEntryPath(
        "/Users/test/pi-app/extensions/app.ts",
        serverSource,
        serverBundle,
        "darwin",
      ),
    ).toBe(serverSource);
  });

  it("adds Node's TypeScript flag only for a source entry", () => {
    expect(nodeServerArgs(serverSource)).toEqual([
      "--experimental-strip-types",
      serverSource,
    ]);
    expect(nodeServerArgs(serverBundle)).toEqual([serverBundle]);
  });
});

describe("Pi SDK entry URLs", () => {
  it.each([
    {
      platform: "darwin",
      packageDir: "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
      expected:
        "file:///usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    },
    {
      platform: "linux",
      packageDir: "/opt/Pi #1% 中文",
      expected: "file:///opt/Pi%20%231%25%20%E4%B8%AD%E6%96%87/dist/index.js",
    },
    {
      platform: "win32",
      packageDir:
        "C:\\Program Files\\nodejs\\node_modules\\@earendil-works\\pi-coding-agent",
      expected:
        "file:///C:/Program%20Files/nodejs/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    },
    {
      platform: "win32",
      packageDir: "D:\\Pi #1% 中文",
      expected: "file:///D:/Pi%20%231%25%20%E4%B8%AD%E6%96%87/dist/index.js",
    },
    {
      platform: "win32",
      packageDir: "\\\\server\\shared apps\\Pi #1% 中文",
      expected:
        "file://server/shared%20apps/Pi%20%231%25%20%E4%B8%AD%E6%96%87/dist/index.js",
    },
    {
      platform: "win32",
      packageDir: "C:/Users/test/AppData/Roaming/npm/node_modules/pi",
      expected:
        "file:///C:/Users/test/AppData/Roaming/npm/node_modules/pi/dist/index.js",
    },
  ])(
    "encodes $platform package path $packageDir",
    ({ platform, packageDir, expected }) => {
      expect(piSdkEntryUrl(packageDir, "./dist/index.js", platform)).toBe(
        expected,
      );
    },
  );
});

describe("host Pi SDK resolution", () => {
  let root: string;
  let packageDir: string;
  let entryPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-app-sdk-"));
    packageDir = join(root, "host Pi #1% 中文");
    entryPath = join(packageDir, "sdk", "entry #1%.js");
    mkdirSync(join(packageDir, "sdk"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@earendil-works/pi-coding-agent",
        type: "module",
        exports: { ".": { import: "./sdk/entry #1%.js" } },
      }),
    );
    writeFileSync(entryPath, 'export const source = "host-sdk";');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("uses the host manifest export instead of a fixed dist entry", () => {
    expect(hostPiSdkUrl(packageDir)).toBe(pathToFileURL(entryPath).href);
  });

  it("loads the host SDK from a separate managed extension directory", () => {
    const extensionDir = join(root, "managed", "node_modules", "pi-native-app");
    mkdirSync(extensionDir, { recursive: true });
    const extensionRequire = createRequire(join(extensionDir, "app.js"));
    expect(() =>
      extensionRequire.resolve("@earendil-works/pi-coding-agent"),
    ).toThrow("Cannot find module");

    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const sdk = await import(process.env.PI_APP_PI_SDK_URL); process.stdout.write(sdk.source);",
      ],
      {
        cwd: extensionDir,
        env: { ...process.env, PI_APP_PI_SDK_URL: hostPiSdkUrl(packageDir) },
        encoding: "utf8",
      },
    );
    expect(output).toBe("host-sdk");
  });

  it("throws when the host package manifest is missing", () => {
    rmSync(join(packageDir, "package.json"));
    expect(() => hostPiSdkUrl(packageDir)).toThrow("ENOENT");
  });

  it("throws when the host package manifest is invalid", () => {
    writeFileSync(join(packageDir, "package.json"), "{");
    expect(() => hostPiSdkUrl(packageDir)).toThrow(SyntaxError);
  });

  it("throws when the host package has no ESM export", () => {
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ exports: {} }),
    );
    expect(() => hostPiSdkUrl(packageDir)).toThrow(TypeError);
  });

  it("throws when the exported SDK entry is missing", () => {
    rmSync(entryPath);
    expect(() => hostPiSdkUrl(packageDir)).toThrow("ENOENT");
  });
});

describe("browser launch command", () => {
  it("opens the browser with the Windows command processor", () => {
    expect(browserLaunchCommand("win32", "http://127.0.0.1:1420")).toEqual({
      file: "cmd.exe",
      args: ["/d", "/c", "start", "", "http://127.0.0.1:1420"],
    });
  });

  it("keeps the macOS and Linux browser commands", () => {
    expect(browserLaunchCommand("darwin", "http://127.0.0.1:1420")).toEqual({
      file: "open",
      args: ["http://127.0.0.1:1420"],
    });
    expect(browserLaunchCommand("linux", "http://127.0.0.1:1420")).toEqual({
      file: "xdg-open",
      args: ["http://127.0.0.1:1420"],
    });
  });
});
