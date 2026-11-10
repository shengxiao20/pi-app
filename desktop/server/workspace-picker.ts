import { execFile } from "node:child_process";
import { isAbsolute, win32 } from "node:path";
import { promisify } from "node:util";
import { WorkspaceConflict } from "./workspace-access.ts";

const execute = promisify(execFile);

export const MACOS_PICKER_SCRIPT = `
function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.activate();
  try {
    const folder = app.chooseFolder({
      withPrompt: "Select workspace",
      defaultLocation: Path(argv[0])
    });
    return JSON.stringify({ path: folder.toString() });
  } catch (error) {
    if (error.errorNumber === -128) return JSON.stringify({ path: null });
    throw error;
  }
}
`;

export const WINDOWS_PICKER_SCRIPT = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$owner = New-Object System.Windows.Forms.Form
try {
  $owner.TopMost = $true
  $dialog.Description = "Select workspace"
  $dialog.ShowNewFolderButton = $false
  $dialog.SelectedPath = $env:PI_APP_WORKSPACE_PICKER_PATH
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    @{ path = $dialog.SelectedPath } | ConvertTo-Json -Compress
  } else {
    @{ path = $null } | ConvertTo-Json -Compress
  }
} finally {
  $dialog.Dispose()
  $owner.Dispose()
}
`;

type PickerCommand = {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};
export type PickerExecutor = (
  file: string,
  args: string[],
  options: { encoding: "utf8"; windowsHide: boolean; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

const commands = new Map<string, (cwd: string) => PickerCommand>([
  [
    "darwin",
    (cwd) => ({
      file: "/usr/bin/osascript",
      args: ["-l", "JavaScript", "-e", MACOS_PICKER_SCRIPT, cwd],
      env: process.env,
    }),
  ],
  [
    "win32",
    (cwd) => ({
      file: "powershell.exe",
      args: ["-NoProfile", "-STA", "-Command", WINDOWS_PICKER_SCRIPT],
      env: { ...process.env, PI_APP_WORKSPACE_PICKER_PATH: cwd },
    }),
  ],
]);

export class NativeWorkspacePicker {
  #pending = false;
  readonly #platform: string;
  readonly #executor: PickerExecutor;

  constructor(
    platform: string = process.platform,
    executor: PickerExecutor = execute,
  ) {
    this.#platform = platform;
    this.#executor = executor;
  }

  async pick(cwd: string): Promise<string | null> {
    if (this.#pending) {
      throw new WorkspaceConflict(
        "A workspace directory dialog is already open.",
      );
    }
    const commandFor = commands.get(this.#platform);
    if (!commandFor) {
      throw new Error(
        `Workspace directory selection is not supported on ${this.#platform}.`,
      );
    }
    this.#pending = true;
    try {
      const command = commandFor(cwd);
      const { stdout } = await this.#executor(command.file, command.args, {
        encoding: "utf8",
        windowsHide: true,
        env: command.env,
      });
      const result: unknown = JSON.parse(stdout);
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        !("path" in result)
      ) {
        throw new Error("Invalid workspace directory dialog result.");
      }
      const path = result.path;
      if (path === null) return null;
      const absolute =
        this.#platform === "win32" ? win32.isAbsolute : isAbsolute;
      if (typeof path !== "string" || !absolute(path)) {
        throw new Error(
          "The directory dialog did not return an absolute path.",
        );
      }
      return path;
    } finally {
      this.#pending = false;
    }
  }
}
