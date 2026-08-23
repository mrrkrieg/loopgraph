import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean | number>;
};

type WorkflowJob = {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
};

const pinnedActions = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  setupNode: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  uploadArtifact: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  downloadArtifact: "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
  attestBuildProvenance:
    "actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be"
} as const;

describe("staging release workflow contract", () => {
  it("requires every protected and commit-bound receipt before an attested manifest can be promoted", async () => {
    const source = await readFile(".github/workflows/staging-release.yml", "utf8");
    const workflow = parse(source) as {
      on: { repository_dispatch: { types: string[] } };
      jobs: Record<string, WorkflowJob>;
    };
    const jobs = workflow.jobs;

    expect(workflow.on.repository_dispatch.types).toEqual(["staging-release"]);
    expect(source).not.toContain("workflow_dispatch");
    expect(jobs.verify.if).toBe("github.ref == 'refs/heads/loopgraph/canvas-first'");

    expect(jobs.marketplace.environment).toBe("marketplace-staging");
    expect(jobs["app-snapshots"].environment).toBe("app-snapshot-staging");
    expect(jobs["learning-entities"].environment).toBe("learning-entity-staging");
    expect(jobs["app-snapshot-recovery"].environment).toBe("app-snapshot-recovery");
    expect(jobs["app-snapshot-reconciliation"].environment).toBe("app-snapshot-reconciliation");
    expect(jobs.recovery.environment).toBe("recovery-staging");
    expect(jobs["audit-retention"].environment).toBe("audit-retention-staging");
    expect(jobs.evidence.environment).toBe("release-evidence");
    expect(jobs.promote.environment).toBe("production");
    expect(asNeeds(jobs.evidence.needs)).toEqual([
      "app-snapshot-reconciliation",
      "app-snapshot-recovery",
      "app-snapshots",
      "audit-retention",
      "marketplace",
      "recovery",
      "staging"
    ]);
    expect(asNeeds(jobs.promote.needs)).toEqual(["evidence", "staging"]);
    expect(jobs.promote.if).toBe("${{ github.event.client_payload.promote_production == true }}");

    const evidenceSteps = jobs.evidence.steps ?? [];
    expect(evidenceSteps.some((step) => step.run?.includes("release:evidence:build"))).toBe(true);
    expect(evidenceSteps.some((step) => step.uses === pinnedActions.attestBuildProvenance)).toBe(true);
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

    const allSteps = Object.values(jobs).flatMap((job) => job.steps ?? []);
    const actionSteps = allSteps.filter((step) => step.uses);
    expect(actionSteps.length).toBeGreaterThan(0);
    expect(actionSteps.every((step) =>
      /^actions\/[a-z-]+@[0-9a-f]{40}$/.test(step.uses ?? "")
    )).toBe(true);
    expect(new Set(actionSteps.map((step) => step.uses))).toEqual(new Set(Object.values(pinnedActions)));
    for (const checkout of actionSteps.filter((step) => step.uses === pinnedActions.checkout)) {
      expect(checkout.with).toMatchObject({
        ref: "${{ github.sha }}",
        "persist-credentials": false
      });
    }

    for (const jobName of [
      "marketplace",
      "app-snapshots",
      "learning-entities",
      "app-snapshot-recovery",
      "app-snapshot-reconciliation",
      "recovery",
      "audit-retention"
    ] as const) {
      const jobSource = JSON.stringify(jobs[jobName]);
      expect(jobSource).not.toContain("secrets.LOOPGRAPH_");
    }
    expect(source).toContain("npm run --silent validate:staging > staging-validation-receipt.json");
    expect(source).toContain("npm run --silent prove:app-action-exactly-once > app-action-exactly-once-receipt.json");
    expect(source).toContain("npm run --silent validate:app-snapshots-staging > app-snapshot-staging-receipt.json");
    expect(source).toContain("npm run --silent probe:app-snapshot-fence > app-snapshot-fence-probe-receipt.json");
    expect(source).toContain("npm run --silent validate:learning-entities-staging > learning-entity-staging-receipt.json");
    expect(source).toContain("npm run --silent rehearse:app-snapshot-restore > app-snapshot-recovery-receipt.json");
    expect(source).toContain("npm run --silent reconcile:app-snapshots > app-snapshot-reconciliation-receipt.json");
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
    const snapshotFenceProbeStep = (jobs["app-snapshots"].steps ?? []).find(
      (step) => step.run?.includes("probe:app-snapshot-fence")
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
    expect(snapshotFenceProbeStep?.env).toEqual({
      LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_ALLOW_MUTATION: "yes",
      LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_SUPABASE_URL:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_URL }}",
      LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_SERVICE_ROLE_KEY_FILE:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE }}",
      LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_EXPECTED_APP_SNAPSHOT_FENCE_PROBE_SCOPE_DIGEST:
        "${{ vars.LOOPGRAPH_EXPECTED_APP_SNAPSHOT_FENCE_PROBE_SCOPE_DIGEST }}"
    });
    expect(source).toContain('value.schemaVersion!=="hosted-app-snapshot-fence-probe/v1"');
    expect(source).toContain("value.checks?.length!==names.length");
    const learningEntityStep = (jobs["learning-entities"].steps ?? []).find(
      (step) => step.run?.includes("validate:learning-entities-staging")
    );
    expect(asNeeds(jobs["learning-entities"].needs)).toEqual(["marketplace"]);
    expect(learningEntityStep?.env).toEqual({
      LOOPGRAPH_LEARNING_ENTITY_PROBE_ALLOW_MUTATION: "yes",
      LOOPGRAPH_LEARNING_ENTITY_PROBE_SUPABASE_URL:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_URL }}",
      LOOPGRAPH_LEARNING_ENTITY_PROBE_SERVICE_ROLE_KEY_FILE:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_SERVICE_ROLE_KEY_FILE }}",
      LOOPGRAPH_LEARNING_ENTITY_PROBE_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_EXPECTED_LEARNING_ENTITY_PROBE_SCOPE_DIGEST:
        "${{ vars.LOOPGRAPH_EXPECTED_LEARNING_ENTITY_PROBE_SCOPE_DIGEST }}"
    });
    expect(source).toContain('value.schemaVersion!=="hosted-learning-entity-staging-validation/v1"');
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
    const snapshotReconciliationStep = (jobs["app-snapshot-reconciliation"].steps ?? []).find(
      (step) => step.run?.includes("reconcile:app-snapshots")
    );
    expect(asNeeds(jobs["app-snapshot-reconciliation"].needs)).toEqual(["app-snapshots", "marketplace"]);
    expect(snapshotReconciliationStep?.env).toEqual({
      LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SUPABASE_URL:
        "${{ needs.app-snapshots.outputs.storage_origin }}",
      LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SERVICE_ROLE_KEY_FILE:
        "${{ vars.LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_SERVICE_ROLE_KEY_FILE }}",
      LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_PROJECT_KEY:
        "${{ needs.marketplace.outputs.project_key }}",
      LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RECONCILIATION_SCOPE_DIGEST:
        "${{ vars.LOOPGRAPH_EXPECTED_APP_SNAPSHOT_RECONCILIATION_SCOPE_DIGEST }}",
      LOOPGRAPH_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST:
        "${{ vars.LOOPGRAPH_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST }}",
      LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ALLOW_EMPTY:
        "${{ vars.LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_ALLOW_EMPTY }}"
    });
    expect(source).toContain('value.schemaVersion!=="hosted-app-snapshot-reconciliation/v3"');
    expect(source).toContain("value.checks?.length!==10");
    expect(source).toContain("value.inventoryFenceDigest");
    expect(JSON.stringify(jobs["app-snapshot-reconciliation"])).toContain("persist-credentials");
    expect(JSON.stringify(jobs["app-snapshot-reconciliation"])).not.toMatch(/actions\/[a-z-]+@v\d/);
    expect(source.match(/LOOPGRAPH_RELEASE_AUDIT_RETENTION_PUBLIC_KEY_PEM/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_ACTION_EXACTLY_ONCE_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_FENCE_PROBE_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_STAGING_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_RECOVERY_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_RELEASE_STORAGE_URL/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_RELEASE_SNAPSHOT_RESTORE_URL/g)).toHaveLength(2);
    expect(source.match(/^\s+LOOPGRAPH_RELEASE_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST:/gm))
      .toHaveLength(2);
  });
});

function asNeeds(value: string | string[] | undefined) {
  return (typeof value === "string" ? [value] : value ?? []).slice().sort();
}
