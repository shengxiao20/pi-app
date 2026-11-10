// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { webPiClient } from "./pi-client";

afterEach(() => vi.unstubAllGlobals());

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
    expect(fetch).toHaveBeenCalledWith("/api/clipboard-images", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: image,
    });
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
