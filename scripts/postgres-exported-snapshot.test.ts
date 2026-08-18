import { describe, expect, it } from "vitest";
import {
  parseExportedSnapshotMarker,
  snapshotFingerprintSql
} from "./postgres-exported-snapshot";

describe("PostgreSQL exported recovery snapshot", () => {
  it("extracts only a bounded PostgreSQL snapshot identifier", () => {
    expect(parseExportedSnapshotMarker(
      "LOOPGRAPH_EXPORTED_SNAPSHOT=00000003-0000001B-1\n"
    )).toBe("00000003-0000001B-1");
    expect(parseExportedSnapshotMarker("waiting\n")).toBeNull();
    expect(() => parseExportedSnapshotMarker(
      "LOOPGRAPH_EXPORTED_SNAPSHOT=bad'; drop table x;--\n"
    )).toThrow(/invalid/i);
  });

  it("binds fingerprint SQL to the exported repeatable-read snapshot", () => {
    const sql = snapshotFingerprintSql(
      "00000003-0000001B-1",
      "select count(*) from public.marketplace_apps;"
    );
    expect(sql).toContain("begin isolation level repeatable read read only");
    expect(sql).toContain("set transaction snapshot '00000003-0000001B-1'");
    expect(sql).toContain("public.marketplace_apps");
  });
});
