import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};

type WorkflowJob = {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
};

describe("staging release workflow contract", () => {
  it("requires every protected and commit-bound receipt before an attested manifest can be promoted", async () => {
    const source = await readFile(".github/workflows/staging-release.yml", "utf8");
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> };
    const jobs = workflow.jobs;

    expect(jobs.verify.if).toBe("github.ref == 'refs/heads/loopgraph/canvas-first'");

    expect(jobs.marketplace.environment).toBe("marketplace-staging");
    expect(jobs["app-snapshots"].environment).toBe("app-snapshot-staging");
    expect(jobs["app-snapshot-recovery"].environment).toBe("app-snapshot-recovery");
    expect(jobs.recovery.environment).toBe("recovery-staging");
    expect(jobs["audit-retention"].environment).toBe("audit-retention-staging");
    expect(jobs.evidence.environment).toBe("release-evidence");
    expect(jobs.promote.environment).toBe("production");
    expect(asNeeds(jobs.evidence.needs)).toEqual([
      "app-snapshot-recovery",
      "app-snapshots",
      "audit-retention",
      "marketplace",
      "recovery",
      "staging"
    ]);
    expect(asNeeds(jobs.promote.needs)).toEqual(["evidence", "staging"]);

    const evidenceSteps = jobs.evidence.steps ?? [];
    expect(evidenceSteps.some((step) => step.run?.includes("release:evidence:build"))).toBe(true);
    expect(evidenceSteps.some((step) => step.uses === "actions/attest-build-provenance@v2")).toBe(true);
    expect(jobs.evidence.permissions).toMatchObject({
      contents: "read",
      "id-token": "write",
      attestations: "write"
    });

    const promoteSteps = jobs.promote.steps ?? [];
    const verifyIndex = promoteSteps.findIndex((step) => step.run?.includes("release:evidence:verify"));
    const attestIndex = promoteSteps.findIndex((step) => step.run?.includes("gh attestation verify"));
    const promoteIndex = promoteSteps.findIndex((step) => step.run?.includes("vercel promote"));
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(attestIndex).toBeGreaterThan(verifyIndex);
    expect(promoteIndex).toBeGreaterThan(attestIndex);
    expect(jobs.promote.permissions).toMatchObject({ attestations: "read" });

    for (const jobName of [
      "marketplace",
      "app-snapshots",
      "app-snapshot-recovery",
      "recovery",
      "audit-retention"
    ] as const) {
      const jobSource = JSON.stringify(jobs[jobName]);
      expect(jobSource).not.toContain("secrets.LOOPGRAPH_");
    }
    expect(source).toContain("npm run --silent validate:staging > staging-validation-receipt.json");
    expect(source).toContain("npm run --silent prove:app-action-exactly-once > app-action-exactly-once-receipt.json");
    expect(source).toContain("npm run --silent validate:app-snapshots-staging > app-snapshot-staging-receipt.json");
    expect(source).toContain("npm run --silent rehearse:app-snapshot-restore > app-snapshot-recovery-receipt.json");
    expect(source).toContain("npm run --silent rehearse:restore > recovery-rehearsal-receipt.json");
    expect(source).toContain("npm run --silent audit:drain > audit-retention-receipt.json");
    const auditDrainStep = (jobs["audit-retention"].steps ?? []).find(
      (step) => step.run?.includes("audit:drain")
    );
    expect(auditDrainStep?.env).toMatchObject({
      LOOPGRAPH_AUDIT_STAGING_RECEIPT_FILE:
        "${{ github.workspace }}/release-checkpoints/staging-validation-receipt.json",
      LOOPGRAPH_AUDIT_MARKETPLACE_RECEIPT_FILE:
        "${{ github.workspace }}/release-checkpoints/marketplace-validation-receipt.json"
    });
    const stagingValidationStep = (jobs.marketplace.steps ?? []).find(
      (step) => step.run?.includes("validate:staging")
    );
    expect(stagingValidationStep?.env).toMatchObject({
      LOOPGRAPH_STAGING_SUPABASE_URL: "${{ vars.LOOPGRAPH_STAGING_SUPABASE_URL }}",
      LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY }}",
      LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE }}",
      LOOPGRAPH_STAGING_FOREIGN_USER_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_FOREIGN_USER_SESSION_FILE }}",
      LOOPGRAPH_STAGING_SUSPENDED_USER_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_SUSPENDED_USER_SESSION_FILE }}",
      LOOPGRAPH_STAGING_USER_API_ADMIN_QUOTA_LIMIT:
        "${{ vars.LOOPGRAPH_STAGING_USER_API_ADMIN_QUOTA_LIMIT }}",
      LOOPGRAPH_STAGING_USER_API_QUOTA_MAX_WAIT_SECONDS:
        "${{ vars.LOOPGRAPH_STAGING_USER_API_QUOTA_MAX_WAIT_SECONDS }}"
    });
    const snapshotValidationStep = (jobs["app-snapshots"].steps ?? []).find(
      (step) => step.run?.includes("validate:app-snapshots-staging")
    );
    expect(asNeeds(jobs["app-snapshots"].needs)).toEqual(["marketplace", "staging"]);
    expect(snapshotValidationStep?.env).toMatchObject({
      LOOPGRAPH_STAGING_SUPABASE_URL: "${{ vars.LOOPGRAPH_STAGING_SUPABASE_URL }}",
      LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY }}",
      LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE }}",
      LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_ALLOWED_USER_SESSION_FILE }}",
      LOOPGRAPH_STAGING_ORGANIZATION_ID: "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_STAGING_PROJECT_KEY: "${{ needs.marketplace.outputs.project_key }}"
    });
    const snapshotRecoveryStep = (jobs["app-snapshot-recovery"].steps ?? []).find(
      (step) => step.run?.includes("rehearse:app-snapshot-restore")
    );
    expect(asNeeds(jobs["app-snapshot-recovery"].needs)).toEqual(["app-snapshots", "marketplace"]);
    expect(snapshotRecoveryStep?.env).toMatchObject({
      LOOPGRAPH_CONFIRM_ISOLATED_APP_SNAPSHOT_RESTORE: "yes",
      LOOPGRAPH_APP_SNAPSHOT_BACKUP_SOURCE_URL:
        "${{ needs.app-snapshots.outputs.storage_origin }}",
      LOOPGRAPH_APP_SNAPSHOT_BACKUP_SOURCE_SERVICE_ROLE_KEY_FILE:
        "${{ vars.LOOPGRAPH_APP_SNAPSHOT_BACKUP_SOURCE_SERVICE_ROLE_KEY_FILE }}",
      LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_URL:
        "${{ vars.LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_URL }}",
      LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_SERVICE_ROLE_KEY_FILE:
        "${{ vars.LOOPGRAPH_APP_SNAPSHOT_RESTORE_TARGET_SERVICE_ROLE_KEY_FILE }}",
      LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RESTORE_ORIGIN:
        "${{ vars.LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RESTORE_ORIGIN }}",
      LOOPGRAPH_APP_SNAPSHOT_RESTORE_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_APP_SNAPSHOT_RESTORE_PROJECT_KEY:
        "${{ needs.marketplace.outputs.project_key }}"
    });
    expect(source.match(/LOOPGRAPH_RELEASE_AUDIT_RETENTION_PUBLIC_KEY_PEM/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_ACTION_EXACTLY_ONCE_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_STAGING_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_RECOVERY_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_RELEASE_STORAGE_URL/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_RELEASE_SNAPSHOT_RESTORE_URL/g)).toHaveLength(2);
  });
});

function asNeeds(value: string | string[] | undefined) {
  return (typeof value === "string" ? [value] : value ?? []).slice().sort();
}
