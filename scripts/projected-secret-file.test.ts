import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectedSecretFile } from "./projected-secret-file";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("projected secret files", () => {
  it("reads one bounded private regular file", async () => {
    const root = await temporaryRoot();
    const file = path.join(root, "service-role");
    await writeFile(file, "one-secret-value-with-enough-entropy", { mode: 0o600 });
    expect(await readProjectedSecretFile(file, "SERVICE_ROLE_FILE"))
      .toBe("one-secret-value-with-enough-entropy");
  });

  it("rejects relative, group-readable, and symbolic-link paths", async () => {
    await expect(readProjectedSecretFile("relative-secret", "SERVICE_ROLE_FILE"))
      .rejects.toThrow(/absolute/);

    const root = await temporaryRoot();
    const file = path.join(root, "service-role");
    const link = path.join(root, "service-role-link");
    await writeFile(file, "one-secret-value-with-enough-entropy", { mode: 0o600 });
    await chmod(file, 0o640);
    await expect(readProjectedSecretFile(file, "SERVICE_ROLE_FILE"))
      .rejects.toThrow(/group or other/);
    await chmod(file, 0o600);
    await symlink(file, link);
    await expect(readProjectedSecretFile(link, "SERVICE_ROLE_FILE")).rejects.toThrow();
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-projected-secret-"));
  roots.push(root);
  return root;
}
