import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(extensionRoot, "dist");
const command = process.argv[2];

if (command === "clean") {
  await rm(dist, { recursive: true, force: true });
} else if (command === "copy") {
  await mkdir(dist, { recursive: true });
  const publicDirectory = join(extensionRoot, "public");
  for (const entry of await readdir(publicDirectory)) {
    await cp(join(publicDirectory, entry), join(dist, entry), { recursive: true });
  }
} else {
  throw new Error("Expected build phase: clean or copy");
}
