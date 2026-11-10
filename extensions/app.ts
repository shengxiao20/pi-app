import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HOST = "127.0.0.1";
const PORT = 1420;
const BASE_URL = `http://${HOST}:${PORT}`;
const SERVICE_NAME = "pi-app";
const SERVER_PATH = fileURLToPath(
  new URL("../desktop/server/index.ts", import.meta.url),
);

export default function registerAppCommand(pi: ExtensionAPI): void {
  pi.registerCommand("app", {
    description: "Open the Pi App local web client",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      if (!(await isServerReady())) startServer(ctx.cwd);
      await waitForServer();
      await selectWorkspace(ctx.cwd);
      openBrowser(BASE_URL);
      ctx.ui.notify(`Pi App opened at ${BASE_URL}`, "info");
    },
  });
}

async function isServerReady(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: string };
    return body.service === SERVICE_NAME;
  } catch {
    return false;
  }
}

function startServer(cwd: string): void {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", SERVER_PATH],
    {
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PI_APP_PI_SDK_URL: import.meta.resolve(
          "@earendil-works/pi-coding-agent",
        ),
        PI_APP_WORKSPACE: cwd,
        PORT: String(PORT),
      },
      stdio: "ignore",
    },
  );
  child.unref();
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Pi App server did not start within five seconds.");
}

async function selectWorkspace(path: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/workspace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (response.ok) return;
  const body = (await response.json()) as { message?: string };
  throw new Error(body.message ?? `Pi App returned HTTP ${response.status}.`);
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
