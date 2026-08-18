import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseRecoveryDatabaseUrl,
  pgpassEntry,
  postgresChildEnvironment,
  postgresConnectionArgs,
  readRecoveryDatabaseUrl,
  validateRehearsalTargetMarker
} from "./postgres-recovery-connection";

describe("PostgreSQL recovery connection", () => {
  it("keeps credentials out of process arguments and passes them through a pgpass file", () => {
    const connection = parseRecoveryDatabaseUrl(
      "postgresql://restore_user:super%3Asecret@db.example.test:6543/loopgraph_restore?sslmode=verify-full",
      "target"
    );
    const args = postgresConnectionArgs(connection);

    expect(args).toEqual([
      "--host", "db.example.test",
      "--port", "6543",
      "--username", "restore_user",
      "--dbname", "loopgraph_restore"
    ]);
    expect(JSON.stringify(args)).not.toContain("super:secret");
    expect(pgpassEntry(connection)).toBe(
      "db.example.test:6543:loopgraph_restore:restore_user:super\\:secret"
    );
    expect(postgresChildEnvironment(connection, "/private/pgpass", {
      PATH: "/usr/bin",
      LOOPGRAPH_BACKUP_SOURCE_DB_URL: "must-not-reach-child"
    })).toEqual({
      PATH: "/usr/bin",
      NODE_ENV: "production",
      PGPASSFILE: "/private/pgpass",
      PGSSLMODE: "verify-full",
      PGCONNECT_TIMEOUT: "15"
    });
  });

  it("requires complete credentials and encrypted remote connections", () => {
    expect(() => parseRecoveryDatabaseUrl(
      "postgresql://user:password@db.example.test/restore?sslmode=require",
      "target"
    )).toThrow(/sslmode/i);
    expect(() => parseRecoveryDatabaseUrl(
      "postgresql://user@db.example.test/restore?sslmode=require",
      "target"
    )).toThrow(/password/i);
  });

  it("permits an explicitly isolated local PostgreSQL service", () => {
    const connection = parseRecoveryDatabaseUrl(
      "postgresql://user:password@127.0.0.1/loopgraph_test?sslmode=disable",
      "target"
    );
    expect(connection.identity).toBe("127.0.0.1:5432/loopgraph_test");
    expect(connection.sslMode).toBe("disable");
  });

  it("requires a high-entropy disposable-target database marker", () => {
    expect(validateRehearsalTargetMarker("rehearsal_0123456789abcdef0123456")).toBe(
      "loopgraph-disposable-restore:rehearsal_0123456789abcdef0123456"
    );
    expect(() => validateRehearsalTargetMarker("rehearsal"))
      .toThrow(/unique 32-128/i);
  });

  it("reads projected database URLs only from bounded private files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "loopgraph-db-url-test-"));
    const file = path.join(directory, "database-url");
    try {
      await writeFile(
        file,
        "postgresql://user:password@db.example.test/restore?sslmode=verify-full\n",
        { mode: 0o600 }
      );
      await expect(readRecoveryDatabaseUrl("DATABASE_URL", {
        DATABASE_URL_FILE: file
      })).resolves.toContain("db.example.test");
      await expect(readRecoveryDatabaseUrl("DATABASE_URL", {
        DATABASE_URL: "postgresql://direct",
        DATABASE_URL_FILE: file
      })).rejects.toThrow(/only one/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
