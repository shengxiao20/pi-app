import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const outputDirectory = new URL("./server-build/", import.meta.url);
const entryPoint = new URL("./server/index.ts", import.meta.url);
const outputFile = new URL("./server-build/index.js", import.meta.url);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  bundle: true,
  entryPoints: [fileURLToPath(entryPoint)],
  outfile: fileURLToPath(outputFile),
  packages: "external",
  platform: "node",
  target: "node22",
  format: "esm",
});

console.log(`Built server entry: ${fileURLToPath(outputFile)}`);
