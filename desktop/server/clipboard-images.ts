import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

const imageFormats: Record<
  string,
  { extension: string; matches: (data: Buffer) => boolean }
> = {
  "image/png": {
    extension: "png",
    matches: (data) =>
      data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (data) => data.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  },
  "image/gif": {
    extension: "gif",
    matches: (data) =>
      ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6)),
  },
  "image/webp": {
    extension: "webp",
    matches: (data) =>
      data.length >= 12 &&
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP",
  },
};

/** Save image bytes, never a client-supplied path or filename. */
export async function saveClipboardImage(
  request: IncomingMessage,
): Promise<string> {
  const mimeType = request.headers["content-type"];
  const format =
    typeof mimeType === "string" && Object.hasOwn(imageFormats, mimeType)
      ? imageFormats[mimeType]
      : undefined;
  if (!format) {
    throw new Error("Clipboard images must use PNG, JPEG, GIF, or WebP.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_CLIPBOARD_IMAGE_BYTES) {
      throw new Error("Clipboard images must not exceed 20 MiB.");
    }
    chunks.push(buffer);
  }
  const data = Buffer.concat(chunks);
  if (!format.matches(data)) {
    throw new Error(
      "Clipboard image bytes do not match the declared image type.",
    );
  }
  const path = join(
    tmpdir(),
    `pi-clipboard-${randomUUID()}.${format.extension}`,
  );
  await writeFile(path, data, { flag: "wx", mode: 0o600 });
  return path;
}
