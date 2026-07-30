import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileStorageAdapter } from "./storage";

describe("FileStorageAdapter path confinement", () => {
  it("does not allow a run ID to escape the traces directory", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-storage-"));
    const storageRoot = path.join(projectRoot, ".loopgraph");
    await mkdir(storageRoot, { recursive: true });
    const sentinelPath = path.join(projectRoot, "sentinel.json");
    await writeFile(sentinelPath, JSON.stringify({ secret: true }));
    const storage = new FileStorageAdapter(storageRoot);

    await expect(storage.getRun("../../sentinel")).resolves.toBeNull();
    await expect(readFile(sentinelPath, "utf8")).resolves.toContain("\"secret\":true");
  });
});
