import { describe, expect, it } from "vitest";
import {
  browserLaunchCommand,
  nodeServerArgs,
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
