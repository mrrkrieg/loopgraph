import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function validateProjectedWorkloadToken(token: string, label: string) {
  if (token.length < 32 || token.length > 64 * 1024 || !TOKEN_PATTERN.test(token)) {
    throw new Error(`${label} did not contain a bounded workload JWT`);
  }
  return token;
}

export async function readProjectedWorkloadTokenFile(file: string, label: string) {
  if (!path.isAbsolute(file)) {
    throw new Error(`${label} must be an absolute projected-token path`);
  }
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 32 || metadata.size > 64 * 1024) {
      throw new Error(`${label} must reference one bounded regular file`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`${label} must not be readable or writable by group or other users`);
    }
    return validateProjectedWorkloadToken((await handle.readFile("utf8")).trim(), label);
  } finally {
    await handle?.close();
  }
}
