import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  MACOS_PICKER_SCRIPT,
  NativeWorkspacePicker,
  WINDOWS_PICKER_SCRIPT,
  type PickerExecutor,
} from "./workspace-picker.ts";

function executorReturning(stdout: string) {
  return vi.fn<PickerExecutor>().mockResolvedValue({ stdout });
}

describe("NativeWorkspacePicker", () => {
  it("loads with the Node TypeScript strip-only runtime", () => {
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        "import('./server/workspace-picker.ts').then(({ NativeWorkspacePicker }) => new NativeWorkspacePicker('linux'))",
      ],
      { cwd: process.cwd() },
    );
  });

  it("opens the macOS folder dialog at the current workspace", async () => {
    const executor = executorReturning('{"path":"/Users/test/Project B"}');
    const picker = new NativeWorkspacePicker("darwin", executor);

    await expect(picker.pick("/Users/test/Project A")).resolves.toBe(
      "/Users/test/Project B",
    );
    expect(executor).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", MACOS_PICKER_SCRIPT, "/Users/test/Project A"],
      expect.objectContaining({ encoding: "utf8", windowsHide: true }),
    );
    expect(MACOS_PICKER_SCRIPT).toContain("app.chooseFolder");
  });

  it("opens a Windows STA folder dialog with the current folder", async () => {
    const executor = executorReturning('{"path":"D:\\\\Project B"}');
    const picker = new NativeWorkspacePicker("win32", executor);

    await expect(picker.pick("C:\\Project A")).resolves.toBe("D:\\Project B");
    expect(executor).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", WINDOWS_PICKER_SCRIPT],
      expect.objectContaining({
        env: expect.objectContaining({
          PI_APP_WORKSPACE_PICKER_PATH: "C:\\Project A",
        }),
      }),
    );
    expect(WINDOWS_PICKER_SCRIPT).toContain("FolderBrowserDialog");
  });

  it.each(["darwin", "win32"])(
    "returns null when %s selection is cancelled",
    async (platform) => {
      const picker = new NativeWorkspacePicker(
        platform,
        executorReturning('{"path":null}'),
      );
      await expect(
        picker.pick(platform === "win32" ? "C:\\Project" : "/Project"),
      ).resolves.toBeNull();
    },
  );

  it("rejects unsupported platforms", async () => {
    const picker = new NativeWorkspacePicker("linux", executorReturning("{}"));
    await expect(picker.pick("/project")).rejects.toThrow(
      "not supported on linux",
    );
  });

  it.each(["not json", "{}", '{"path":"relative"}', '{"path":7}'])(
    "rejects an invalid dialog result: %s",
    async (stdout) => {
      const picker = new NativeWorkspacePicker(
        "darwin",
        executorReturning(stdout),
      );
      await expect(picker.pick("/project")).rejects.toThrow();
    },
  );

  it("rejects a second picker while the first dialog is open", async () => {
    let finish!: (value: { stdout: string }) => void;
    const executor = vi.fn<PickerExecutor>(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const picker = new NativeWorkspacePicker("darwin", executor);
    const first = picker.pick("/project");

    await expect(picker.pick("/project")).rejects.toThrow("already open");
    finish({ stdout: '{"path":"/next"}' });
    await expect(first).resolves.toBe("/next");
  });
});
