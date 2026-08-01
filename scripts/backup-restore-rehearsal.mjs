import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

if (process.env.LOOPGRAPH_CONFIRM_ISOLATED_RESTORE !== "yes") throw new Error("Set LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes only after verifying the restore target is isolated and disposable");
const source = required("LOOPGRAPH_BACKUP_SOURCE_DB_URL");
const target = required("LOOPGRAPH_REHEARSAL_RESTORE_DB_URL");
const sourceIdentity = databaseIdentity(source);
const targetIdentity = databaseIdentity(target);
if (sourceIdentity === targetIdentity) throw new Error("Backup source and rehearsal restore target resolve to the same database");
const targetDatabase = decodeURIComponent(new URL(target).pathname.replace(/^\//, ""));
if (!/(rehearsal|restore|disposable|test)/i.test(targetDatabase)) throw new Error("Restore target database name must explicitly contain rehearsal, restore, disposable, or test");
const run = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "loopgraph-restore-"));
const dump = path.join(directory, "staging.dump");
const startedAt = new Date();
try {
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dump, source], { timeout: 20 * 60_000, maxBuffer: 1024 * 1024 });
  const dumpSizeBytes = (await stat(dump)).size;
  if (dumpSizeBytes < 1024) throw new Error("Backup artifact is unexpectedly small");
  await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", target, dump], { timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  const { stdout } = await run("psql", [target, "--tuples-only", "--command", "select count(*) from information_schema.tables where table_schema = 'public';"], { timeout: 60_000 });
  const tableCount = Number.parseInt(stdout.trim(), 10);
  if (!Number.isInteger(tableCount) || tableCount < 10) throw new Error(`Restored schema validation failed: ${stdout.trim()}`);
  console.log(JSON.stringify({ schemaVersion: "backup-restore-rehearsal/v1", startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), dumpSizeBytes, publicTableCount: tableCount, sourceHost: new URL(source).hostname, targetHost: new URL(target).hostname }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function databaseIdentity(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Backup URLs must use postgres:// or postgresql://");
  return `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.replace(/^\//, ""))}`;
}
