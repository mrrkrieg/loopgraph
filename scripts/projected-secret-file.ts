import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

export async function readProjectedSecretFile(file: string, label: string): Promise<string> {
  if (!path.isAbsolute(file)) throw new Error(`${label} must be an absolute secret-file path`);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 20 || metadata.size > 64 * 1024) {
      throw new Error(`${label} must reference one bounded regular file`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`${label} must not be readable or writable by group or other users`);
    }
    const value = (await handle.readFile("utf8")).trim();
    if (value.length < 20 || value.length > 64 * 1024 || /[\r\n\0]/.test(value)) {
      throw new Error(`${label} did not contain one bounded secret`);
    }
    return value;
  } finally {
    await handle?.close();
  }
}
