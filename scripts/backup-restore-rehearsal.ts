import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  auditIntegritySql,
  compareRecoveryFingerprints,
  parseAuditIntegrity,
  parseEvidenceRecordCounts,
  parseRecoveryFingerprints,
  recordTypeCountsSql,
  recoveryFingerprintSql
} from "./recovery-contract";
import {
  parseRecoveryDatabaseUrl,
  pgpassEntry,
  postgresChildEnvironment,
  postgresConnectionArgs,
  readRecoveryDatabaseUrl,
  validateRehearsalTargetMarker,
  type RecoveryDatabaseConnection
} from "./postgres-recovery-connection";
import {
  openExportedPostgresSnapshot,
  snapshotFingerprintSql
} from "./postgres-exported-snapshot";

const execFileAsync = promisify(execFile);
const MAX_COMMAND_OUTPUT = 16 * 1024 * 1024;

if (process.env.LOOPGRAPH_CONFIRM_ISOLATED_RESTORE !== "yes") {
  throw new Error(
    "Set LOOPGRAPH_CONFIRM_ISOLATED_RESTORE=yes only after verifying the restore target is isolated and disposable"
  );
}

const source = parseRecoveryDatabaseUrl(
  await readRecoveryDatabaseUrl("LOOPGRAPH_BACKUP_SOURCE_DB_URL"),
  "LOOPGRAPH_BACKUP_SOURCE_DB_URL"
);
const target = parseRecoveryDatabaseUrl(
  await readRecoveryDatabaseUrl("LOOPGRAPH_REHEARSAL_RESTORE_DB_URL"),
  "LOOPGRAPH_REHEARSAL_RESTORE_DB_URL"
);
const sourceIdentityDigest = identityDigest(source.identity);
const targetIdentityDigest = identityDigest(target.identity);
if (sourceIdentityDigest !== required("LOOPGRAPH_EXPECTED_SOURCE_DB_IDENTITY_DIGEST")) {
  throw new Error("Backup source does not match the protected production database identity");
}
const expectedTargetMarker = validateRehearsalTargetMarker(
  required("LOOPGRAPH_REHEARSAL_TARGET_MARKER")
);
if (source.identity === target.identity) {
  throw new Error("Backup source and rehearsal restore target resolve to the same database");
}
if (!/(rehearsal|restore|disposable|test)/i.test(target.database)) {
  throw new Error(
    "Restore target database name must explicitly contain rehearsal, restore, disposable, or test"
  );
}

const directory = await mkdtemp(path.join(tmpdir(), "loopgraph-restore-"));
const dump = path.join(directory, "staging.dump");
const sourcePgpass = path.join(directory, "source.pgpass");
const targetPgpass = path.join(directory, "target.pgpass");
const startedAt = new Date();

try {
  await writePrivateFile(sourcePgpass, `${pgpassEntry(source)}\n`);
  await writePrivateFile(targetPgpass, `${pgpassEntry(target)}\n`);

  const [sourceVersion, targetVersion] = await Promise.all([
    queryScalar(source, sourcePgpass, "show server_version_num;"),
    queryScalar(target, targetPgpass, "show server_version_num;")
  ]);
  const sourceMajor = postgresMajor(sourceVersion);
  const targetMajor = postgresMajor(targetVersion);
  if (sourceMajor !== targetMajor) {
    throw new Error(
      `PostgreSQL major version mismatch: source ${sourceMajor}, target ${targetMajor}`
    );
  }

  const targetTableCountBefore = parseInteger(await queryScalar(
    target,
    targetPgpass,
    "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';"
  ), "pre-restore public table count");
  if (targetTableCountBefore !== 0) {
    throw new Error(
      "Restore target must contain zero public base tables before the destructive rehearsal"
    );
  }
  const observedTargetMarker = await queryScalar(
    target,
    targetPgpass,
    "select coalesce(obj_description(oid, 'pg_database'), 'unmarked') from pg_database where datname = current_database();"
  );
  if (observedTargetMarker !== expectedTargetMarker) {
    throw new Error(
      "Restore target database comment does not match LOOPGRAPH_REHEARSAL_TARGET_MARKER"
    );
  }

  const exportedSnapshot = await openExportedPostgresSnapshot(source, sourcePgpass);
  let sourceFingerprints;
  const dumpStartedAt = Date.now();
  try {
    sourceFingerprints = parseRecoveryFingerprints(await query(
      source,
      sourcePgpass,
      snapshotFingerprintSql(exportedSnapshot.id, recoveryFingerprintSql())
    ));
    await command(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        `--snapshot=${exportedSnapshot.id}`,
        "--file", dump,
        ...postgresConnectionArgs(source)
      ],
      source,
      sourcePgpass,
      20 * 60_000
    );
  } finally {
    await exportedSnapshot.close();
  }
  const dumpDurationMs = Date.now() - dumpStartedAt;
  const dumpSizeBytes = (await stat(dump)).size;
  if (dumpSizeBytes < 1024) throw new Error("Backup artifact is unexpectedly small");

  const restoreStartedAt = Date.now();
  await command(
    "pg_restore",
    [
      "--exit-on-error",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-acl",
      ...postgresConnectionArgs(target),
      dump
    ],
    target,
    targetPgpass,
    30 * 60_000
  );
  const restoreDurationMs = Date.now() - restoreStartedAt;

  const publicTableCount = parseInteger(await queryScalar(
    target,
    targetPgpass,
    "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';"
  ), "restored public table count");
  const targetFingerprints = parseRecoveryFingerprints(await query(
    target,
    targetPgpass,
    recoveryFingerprintSql()
  ));
  const criticalTables = compareRecoveryFingerprints(sourceFingerprints, targetFingerprints);
  if (publicTableCount < criticalTables.length) {
    throw new Error("Restored schema contains fewer public tables than the recovery contract");
  }

  const auditIntegrity = parseAuditIntegrity(await query(
    target,
    targetPgpass,
    auditIntegritySql()
  ));
  if (!auditIntegrity.valid) {
    throw new Error("Restored security audit chain failed integrity verification");
  }
  const evidenceRecordCounts = parseEvidenceRecordCounts(await query(
    target,
    targetPgpass,
    recordTypeCountsSql()
  ));

  const completedAt = new Date();
  console.log(JSON.stringify({
    schemaVersion: "backup-restore-rehearsal/v2",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    dumpDurationMs,
    restoreDurationMs,
    dumpSizeBytes,
    publicTableCount,
    postgresMajor: sourceMajor,
    sourceHost: source.hostname,
    targetHost: target.hostname,
    sourceIdentityDigest,
    targetIdentityDigest,
    criticalTables,
    auditIntegrity,
    evidenceRecordCounts,
    externalArtifactBytes: {
      verified: false,
      requiredNextGate: "validate:marketplace-staging",
      reason: "PostgreSQL recovery proves marketplace metadata, not external artifact bytes."
    }
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function writePrivateFile(file: string, content: string) {
  await writeFile(file, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new Error("Recovery credential file permissions are unsafe");
    }
  } finally {
    await handle.close();
  }
}

async function query(
  connection: RecoveryDatabaseConnection,
  pgpassFile: string,
  sql: string
) {
  const result = await command(
    "psql",
    [
      ...postgresConnectionArgs(connection),
      "--no-psqlrc",
      "--set", "ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--field-separator", "\t",
      "--command", sql
    ],
    connection,
    pgpassFile,
    2 * 60_000
  );
  return result.stdout;
}

async function queryScalar(
  connection: RecoveryDatabaseConnection,
  pgpassFile: string,
  sql: string
) {
  const output = (await query(connection, pgpassFile, sql)).trim();
  if (!output || output.includes("\n") || output.includes("\t")) {
    throw new Error("Recovery scalar query returned an invalid result");
  }
  return output;
}

async function command(
  executable: string,
  args: string[],
  connection: RecoveryDatabaseConnection,
  pgpassFile: string,
  timeout: number
) {
  return execFileAsync(executable, args, {
    env: postgresChildEnvironment(connection, pgpassFile),
    timeout,
    maxBuffer: MAX_COMMAND_OUTPUT,
    windowsHide: true
  });
}

function postgresMajor(value: string) {
  if (!/^\d{5,6}$/.test(value)) throw new Error("PostgreSQL returned an invalid server version");
  return Math.floor(Number(value) / 10_000);
}

function parseInteger(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

function identityDigest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
