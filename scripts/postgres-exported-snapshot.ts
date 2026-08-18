import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  postgresChildEnvironment,
  postgresConnectionArgs,
  type RecoveryDatabaseConnection
} from "./postgres-recovery-connection";

const SNAPSHOT_MARKER = "LOOPGRAPH_EXPORTED_SNAPSHOT=";
const SNAPSHOT_PATTERN = /^[0-9A-Fa-f-]{3,128}$/;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;

export type ExportedPostgresSnapshot = {
  id: string;
  close: () => Promise<void>;
};

export function parseExportedSnapshotMarker(output: string) {
  const markerIndex = output.indexOf(SNAPSHOT_MARKER);
  if (markerIndex < 0) return null;
  const snapshot = output.slice(markerIndex + SNAPSHOT_MARKER.length).split(/\r?\n/, 1)[0]?.trim();
  if (!snapshot || !SNAPSHOT_PATTERN.test(snapshot)) {
    throw new Error("PostgreSQL returned an invalid exported snapshot identifier");
  }
  return snapshot;
}

export function snapshotFingerprintSql(snapshotId: string, fingerprintSql: string) {
  if (!SNAPSHOT_PATTERN.test(snapshotId)) {
    throw new Error("Cannot construct a query for an invalid PostgreSQL snapshot identifier");
  }
  return `begin isolation level repeatable read read only;\nset transaction snapshot '${snapshotId}';\n${fingerprintSql}\ncommit;`;
}

export async function openExportedPostgresSnapshot(
  connection: RecoveryDatabaseConnection,
  pgpassFile: string
): Promise<ExportedPostgresSnapshot> {
  const child = spawn(
    "psql",
    [
      ...postgresConnectionArgs(connection),
      "--no-psqlrc",
      "--set", "ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--quiet"
    ],
    {
      env: postgresChildEnvironment(connection, pgpassFile),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    if (stdout.length < MAX_DIAGNOSTIC_BYTES) stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_DIAGNOSTIC_BYTES) stderr += chunk;
  });

  child.stdin.write(
    `begin isolation level repeatable read read only;\nselect '${SNAPSHOT_MARKER}' || pg_export_snapshot();\n`
  );

  const snapshotId = await waitForSnapshot(child, () => stdout, () => stderr);
  let closed = false;
  return {
    id: snapshotId,
    close: async () => {
      if (closed) return;
      closed = true;
      if (child.exitCode !== null) {
        if (child.exitCode !== 0) throw snapshotProcessError(stderr);
        return;
      }
      child.stdin.end("commit;\n\\q\n");
      await waitForCleanExit(child, () => stderr);
    }
  };
}

function waitForSnapshot(
  child: ChildProcessWithoutNullStreams,
  stdout: () => string,
  stderr: () => string
) {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while exporting a PostgreSQL backup snapshot"));
    }, 30_000);
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      child.stdout.off("data", checkOutput);
      child.off("error", onError);
      child.off("exit", onExit);
      callback();
    };
    const checkOutput = () => {
      try {
        const snapshot = parseExportedSnapshotMarker(stdout());
        if (snapshot) finish(() => resolve(snapshot));
      } catch (error) {
        child.kill("SIGTERM");
        finish(() => reject(error));
      }
    };
    const onError = () => finish(() => reject(snapshotProcessError(stderr())));
    const onExit = (code: number | null) => finish(() => reject(new Error(
      `PostgreSQL snapshot session exited before exporting a snapshot (code ${code ?? "signal"})`
    )));
    child.stdout.on("data", checkOutput);
    child.once("error", onError);
    child.once("exit", onExit);
    checkOutput();
  });
}

function waitForCleanExit(
  child: ChildProcessWithoutNullStreams,
  stderr: () => string
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while closing the PostgreSQL backup snapshot"));
    }, 10_000);
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      callback();
    };
    const onError = () => finish(() => reject(snapshotProcessError(stderr())));
    const onExit = (code: number | null) => finish(() => code === 0
      ? resolve()
      : reject(snapshotProcessError(stderr())));
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function snapshotProcessError(stderr: string) {
  const detail = stderr.trim().slice(0, 2000);
  return new Error(detail ? `PostgreSQL snapshot session failed: ${detail}` : "PostgreSQL snapshot session failed");
}
