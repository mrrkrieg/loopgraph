import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectedFileWorkloadTokenProvider } from "./workload-token-provider";

const TEST_TOKEN = "header.payload.signature-with-enough-entropy-for-tests";

describe("projected file workload token provider", () => {
  it("reads only an absolute bounded user-protected regular file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopgraph-workload-token-"));
    const file = path.join(root, "controller.jwt");
    await writeFile(file, `${TEST_TOKEN}\n`, { mode: 0o600 });

    await expect(new ProjectedFileWorkloadTokenProvider(file).getToken({ audience: "controller" }))
      .resolves.toBe(TEST_TOKEN);
    expect(() => new ProjectedFileWorkloadTokenProvider("controller.jwt"))
      .toThrow("must be absolute");
  });

  it("rejects group-readable files and symbolic links", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(path.join(tmpdir(), "loopgraph-workload-token-"));
    const file = path.join(root, "controller.jwt");
    const link = path.join(root, "linked.jwt");
    await writeFile(file, TEST_TOKEN, { mode: 0o600 });
    await chmod(file, 0o640);

    await expect(new ProjectedFileWorkloadTokenProvider(file).getToken({ audience: "controller" }))
      .rejects.toThrow("must not be accessible");

    await chmod(file, 0o600);
    await symlink(file, link);
    await expect(new ProjectedFileWorkloadTokenProvider(link).getToken({ audience: "controller" }))
      .rejects.toThrow();
  });
});
