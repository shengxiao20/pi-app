// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPackageDir: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getPackageDir: mocks.getPackageDir,
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

import registerAppCommand from "../../extensions/app.ts";

describe("app command host SDK launch", () => {
  let root: string;
  let entryPath: string;
  const fetchMock = vi.fn<typeof fetch>();
  const registerCommand = vi.fn<ExtensionAPI["registerCommand"]>();
  const waitForIdle = vi.fn();
  const notify = vi.fn();
  const ctx = {
    cwd: "/workspace",
    waitForIdle,
    ui: { notify },
  } as unknown as ExtensionCommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "pi-app-launch-"));
    const packageDir = join(root, "host Pi #1% 中文");
    entryPath = join(packageDir, "sdk", "index.js");
    mkdirSync(join(packageDir, "sdk"), { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ exports: { ".": { import: "./sdk/index.js" } } }),
    );
    writeFileSync(entryPath, "export {};");
    mocks.getPackageDir.mockReturnValue(packageDir);
    mocks.spawn.mockReturnValue({ unref: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);
    registerAppCommand({ registerCommand } as unknown as ExtensionAPI);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("passes the injected host SDK URL to the server process", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ service: "pi-app" }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await registerCommand.mock.calls[0][1].handler("", ctx);

    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(mocks.getPackageDir).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      expect.arrayContaining(["--experimental-strip-types"]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        env: expect.objectContaining({
          NODE_ENV: "production",
          PI_APP_PI_SDK_URL: pathToFileURL(entryPath).href,
          PI_APP_WORKSPACE: ctx.cwd,
          PORT: "1420",
        }),
      }),
    );
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:1420/api/workspace",
      expect.objectContaining({ body: JSON.stringify({ path: ctx.cwd }) }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Pi App opened at http://127.0.0.1:1420",
      "info",
    );
  });

  it("reports a missing SDK entry before spawning a server", async () => {
    rmSync(entryPath);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(
      registerCommand.mock.calls[0][1].handler("", ctx),
    ).rejects.toThrow("ENOENT");

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reuses a healthy server without resolving the host SDK", async () => {
    rmSync(entryPath);
    fetchMock
      .mockResolvedValueOnce(Response.json({ service: "pi-app" }))
      .mockResolvedValueOnce(Response.json({ service: "pi-app" }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await registerCommand.mock.calls[0][1].handler("", ctx);

    expect(mocks.getPackageDir).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][0]).not.toBe(process.execPath);
    expect(notify).toHaveBeenCalledOnce();
  });
});
