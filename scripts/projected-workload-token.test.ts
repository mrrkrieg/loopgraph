import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectedWorkloadTokenFile } from "./projected-workload-token";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("projected workload token files", () => {
  it("reads only a bounded private regular file", async () => {
    const directory = await temporaryDirectory();
    const tokenFile = path.join(directory, "workload.jwt");
    const token = `header.${"a".repeat(40)}.signature`;
    await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });

    await expect(readProjectedWorkloadTokenFile(tokenFile, "test token"))
      .resolves.toBe(token);

    await chmod(tokenFile, 0o640);
    await expect(readProjectedWorkloadTokenFile(tokenFile, "test token"))
      .rejects.toThrow(/group or other users/i);
  });

  it("does not follow a token-file symlink", async () => {
    const directory = await temporaryDirectory();
    const target = path.join(directory, "target.jwt");
    const link = path.join(directory, "link.jwt");
    await writeFile(target, `header.${"b".repeat(40)}.signature`, { mode: 0o600 });
    await symlink(target, link);

    await expect(readProjectedWorkloadTokenFile(link, "test token")).rejects.toBeDefined();
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "loopgraph-token-file-"));
  temporaryDirectories.push(directory);
  return directory;
}
