// @vitest-environment node
import { HttpAgent } from "@ag-ui/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAbsoluteFileSystemPath } from "../shared/filesystem-path";
import { webPiClient } from "./pi-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("filesystem path validation", () => {
  it.each([
    "/tmp/pi-clipboard-image.png",
    "C:\\Users\\I042866\\AppData\\Local\\Temp\\image.png",
    "\\\\server\\share\\image.png",
  ])("accepts the absolute path %s", (path) => {
    expect(isAbsoluteFileSystemPath(path)).toBe(true);
  });

  it.each(["image.png", "C:relative\\image.png", "\\\\server"])(
    "rejects the non-absolute path %s",
    (path) => {
      expect(isAbsoluteFileSystemPath(path)).toBe(false);
    },
  );
});

describe("workspace selection client", () => {
  it("attaches the current workspace ID to the AG-UI run request", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string) =>
        path === "/api/workspace"
          ? Response.json({ id: "workspace-a", path: "/workspace/a" })
          : Response.json([]),
      );
    vi.stubGlobal("fetch", fetch);
    await webPiClient.currentWorkspace();
    const runAgent = vi
      .spyOn(HttpAgent.prototype, "runAgent")
      .mockResolvedValue(undefined as never);

    await webPiClient.runAgent("session-a", "Hello", vi.fn());

    expect((runAgent.mock.contexts[0] as HttpAgent).headers).toEqual({
      "X-Pi-App-Workspace": "workspace-a",
    });
  });

  it("attaches the loaded workspace ID to workspace-scoped requests", async () => {
    const fetch = vi.fn().mockImplementation(async (path: string) => {
      if (path === "/api/workspace") {
        return Response.json({
          id: "/workspace/a",
          path: "/workspace/a",
          displayName: "a",
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetch);

    await webPiClient.currentWorkspace();
    await webPiClient.listSessions();

    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).has("X-Pi-App-Workspace"),
    ).toBe(false);
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Pi-App-Workspace"),
    ).toBe("/workspace/a");
  });

  it("omits stale workspace headers for the system picker and updates after selection", async () => {
    const fetch = vi.fn().mockImplementation(async (path: string) => {
      if (path === "/api/workspace") {
        return Response.json({
          id: "/workspace/a",
          path: "/workspace/a",
          displayName: "a",
        });
      }
      if (path === "/api/workspace/select") {
        return Response.json({
          id: "/workspace/b",
          path: "/workspace/b",
          displayName: "b",
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetch);

    await webPiClient.currentWorkspace();
    await webPiClient.selectWorkspace();
    await webPiClient.listSessions();

    expect(fetch.mock.calls[1]?.[0]).toBe("/api/workspace/select");
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).has("X-Pi-App-Workspace"),
    ).toBe(false);
    expect(
      new Headers(fetch.mock.calls[2]?.[1]?.headers).get("X-Pi-App-Workspace"),
    ).toBe("/workspace/b");
  });

  it("keeps the current workspace ID when the native picker is cancelled", async () => {
    const fetch = vi.fn().mockImplementation(async (path: string) => {
      if (path === "/api/workspace") {
        return Response.json({
          id: "/workspace/a",
          path: "/workspace/a",
          displayName: "a",
        });
      }
      if (path === "/api/workspace/select")
        return new Response(null, { status: 204 });
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetch);

    await webPiClient.currentWorkspace();
    await expect(webPiClient.selectWorkspace()).resolves.toBeUndefined();
    await webPiClient.listSessions();

    expect(
      new Headers(fetch.mock.calls[2]?.[1]?.headers).get("X-Pi-App-Workspace"),
    ).toBe("/workspace/a");
  });
});

describe("clipboard image client", () => {
  it("uploads the original binary image and returns the saved path", async () => {
    const image = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: "image/png",
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ path: "/tmp/pi-clipboard-image.png" }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await webPiClient.saveClipboardImage(image)).toBe(
      "/tmp/pi-clipboard-image.png",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/clipboard-images",
      expect.objectContaining({
        method: "POST",
        body: image,
      }),
    );
    const headers = fetch.mock.calls[0]?.[1]?.headers;
    expect(new Headers(headers).get("Content-Type")).toBe("image/png");
  });

  it("accepts a Windows temporary path returned by the server", async () => {
    const path = "C:\\Users\\I042866\\AppData\\Local\\Temp\\image.png";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ path }, { status: 201 })),
    );
    await expect(
      webPiClient.saveClipboardImage(new Blob([], { type: "image/png" })),
    ).resolves.toBe(path);
  });

  it("throws the server error without a retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { message: "Clipboard images must not exceed 20 MiB." },
          { status: 500 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      webPiClient.saveClipboardImage(new Blob([], { type: "image/png" })),
    ).rejects.toThrow("20 MiB");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([{}, { path: "relative.png" }, { path: 42 }])(
    "rejects an invalid saved path %j",
    async (result) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json(result, { status: 201 })),
      );
      await expect(
        webPiClient.saveClipboardImage(new Blob([], { type: "image/png" })),
      ).rejects.toThrow("absolute path");
    },
  );
});
