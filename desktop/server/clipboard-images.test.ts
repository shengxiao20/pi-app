// @vitest-environment node
import { readFile, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CLIPBOARD_IMAGE_BYTES,
  saveClipboardImage,
} from "./clipboard-images";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X8AAAAASUVORK5CYII=",
  "base64",
);
const paths: string[] = [];

function imageRequest(type: string, chunks: Buffer[]): IncomingMessage {
  const stream = Readable.from(chunks) as IncomingMessage;
  stream.headers = { "content-type": type };
  return stream;
}

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => unlink(path)));
});

describe("clipboard image persistence", () => {
  it("writes unchanged image bytes to a private temporary file", async () => {
    const path = await saveClipboardImage(
      imageRequest("image/png", [png.subarray(0, 4), png.subarray(4)]),
    );
    paths.push(path);
    expect(isAbsolute(path)).toBe(true);
    expect(path).toMatch(/pi-clipboard-[\da-f-]+\.png$/);
    expect(await readFile(path)).toEqual(png);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("uses a unique path for each paste", async () => {
    paths.push(await saveClipboardImage(imageRequest("image/png", [png])));
    paths.push(await saveClipboardImage(imageRequest("image/png", [png])));
    expect(paths[0]).not.toBe(paths[1]);
  });

  it.each(["image/svg+xml", "text/plain", "application/json", "__proto__"])(
    "rejects %s",
    async (type) => {
      await expect(
        saveClipboardImage(imageRequest(type, [png])),
      ).rejects.toThrow("PNG, JPEG, GIF, or WebP");
    },
  );

  it.each([Buffer.alloc(0), Buffer.from("not an image"), Buffer.from("RIFF")])(
    "rejects invalid image bytes %j",
    async (data) => {
      await expect(
        saveClipboardImage(imageRequest("image/png", [data])),
      ).rejects.toThrow("do not match");
    },
  );

  it("rejects a mismatched declared image type", async () => {
    await expect(
      saveClipboardImage(imageRequest("image/jpeg", [png])),
    ).rejects.toThrow("do not match");
  });

  it("rejects uploads over the limit, including chunked requests", async () => {
    await expect(
      saveClipboardImage(
        imageRequest("image/png", [
          png,
          Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES),
        ]),
      ),
    ).rejects.toThrow("20 MiB");
  });
});
