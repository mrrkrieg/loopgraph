import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(packageRoot, "..", "..", "packs");
const destination = path.join(packageRoot, "packs");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true, force: true });
