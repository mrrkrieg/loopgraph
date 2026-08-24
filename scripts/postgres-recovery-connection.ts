const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type RecoveryDatabaseConnection = {
  hostname: string;
  port: string;
  username: string;
  password: string;
  database: string;
  sslMode: string;
  identity: string;
};

export async function readRecoveryDatabaseUrl(
  name: string,
  environment: Record<string, string | undefined> = process.env
) {
  const direct = environment[name]?.trim();
  const fileVariable = `${name}_FILE`;
  const file = environment[fileVariable]?.trim();
  if (direct && file) throw new Error(`Set only one of ${name} or ${fileVariable}`);
  if (direct) return validateDatabaseUrlInput(direct, name);
  if (!file) throw new Error(`${name} or ${fileVariable} is required`);
  if (!path.isAbsolute(file)) throw new Error(`${fileVariable} must be an absolute path`);

  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 16 || metadata.size > 16 * 1024) {
      throw new Error(`${fileVariable} must reference one bounded regular file`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`${fileVariable} must not be readable or writable by group or other users`);
    }
    return validateDatabaseUrlInput((await handle.readFile("utf8")).trim(), fileVariable);
  } finally {
    await handle?.close();
  }
}

function validateDatabaseUrlInput(value: string, label: string) {
  if (/\r|\n|\0/.test(value)) throw new Error(`${label} contains forbidden control characters`);
  return value;
}

export function parseRecoveryDatabaseUrl(value: string, label: string): RecoveryDatabaseConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error(`${label} must use postgres:// or postgresql://`);
  }

  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = url.port || "5432";
  if (!hostname || !username || !password || !database) {
    throw new Error(`${label} must include host, username, password, and database name`);
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new Error(`${label} contains an invalid PostgreSQL port`);
  }
  if (/[\r\n\0]/.test(`${hostname}${username}${password}${database}`)) {
    throw new Error(`${label} contains forbidden control characters`);
  }

  const sslMode = url.searchParams.get("sslmode")?.toLowerCase() || "prefer";
  if (!LOOPBACK_HOSTS.has(hostname) && sslMode !== "verify-full") {
    throw new Error(`${label} must use sslmode=verify-full for a remote host`);
  }
  return {
    hostname,
    port,
    username,
    password,
    database,
    sslMode,
    identity: `${hostname}:${port}/${database}`
  };
}

export function validateRehearsalTargetMarker(value: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
    throw new Error("LOOPGRAPH_REHEARSAL_TARGET_MARKER must be a unique 32-128 character value");
  }
  return `loopgraph-disposable-restore:${value}`;
}

function escapePgpass(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

export function pgpassEntry(connection: RecoveryDatabaseConnection) {
  return [
    connection.hostname,
    connection.port,
    connection.database,
    connection.username,
    connection.password
  ].map(escapePgpass).join(":");
}

export function postgresConnectionArgs(connection: RecoveryDatabaseConnection) {
  return [
    "--host", connection.hostname,
    "--port", connection.port,
    "--username", connection.username,
    "--dbname", connection.database
  ];
}

export function postgresChildEnvironment(
  connection: RecoveryDatabaseConnection,
  pgpassFile: string,
  environment: Record<string, string | undefined> = process.env
): NodeJS.ProcessEnv {
  const safeEnvironment = Object.fromEntries([
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "PGSSLROOTCERT",
    "PGSSLCERT",
    "PGSSLKEY"
  ].flatMap((name) => environment[name] ? [[name, environment[name]!]] : []));
  return {
    ...safeEnvironment,
    NODE_ENV: environment.NODE_ENV === "test" ? "test" : "production",
    PGPASSFILE: pgpassFile,
    PGSSLMODE: connection.sslMode,
    PGCONNECT_TIMEOUT: "15"
  };
}
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
