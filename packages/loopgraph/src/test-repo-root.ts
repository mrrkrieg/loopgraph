import path from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root when tests run from packages/loopgraph/src. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
