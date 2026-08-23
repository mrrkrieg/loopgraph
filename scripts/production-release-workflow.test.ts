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
    expect(jobs["app-evidence-health"].environment).toBe("app-evidence-health-staging");
    expect(jobs["cli-sessions"].environment).toBe("cli-session-staging");
    expect(jobs["cli-admin"].environment).toBe("cli-admin-staging");
    expect(jobs["marketplace-release-revocation"].environment)
      .toBe("marketplace-release-revocation-staging");
    expect(jobs["app-snapshots"].environment).toBe("app-snapshot-staging");
    expect(jobs["learning-entities"].environment).toBe("learning-entity-staging");
    expect(jobs["app-snapshot-recovery"].environment).toBe("app-snapshot-recovery");
    expect(jobs["app-snapshot-reconciliation"].environment).toBe("app-snapshot-reconciliation");
    expect(jobs.recovery.environment).toBe("recovery-staging");
    expect(jobs["audit-retention"].environment).toBe("audit-retention-staging");
    expect(jobs.evidence.environment).toBe("release-evidence");
    expect(jobs.promote.environment).toBe("production");
    expect(asNeeds(jobs.evidence.needs)).toEqual([
      "app-evidence-health",
      "app-snapshot-reconciliation",
      "app-snapshot-recovery",
      "app-snapshots",
      "audit-retention",
      "cli-admin",
      "cli-sessions",
      "learning-entities",
      "marketplace",
      "marketplace-release-revocation",
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
      "app-evidence-health",
      "cli-admin",
      "cli-sessions",
      "marketplace-release-revocation",
      "learning-entities",
      "app-snapshots",
      "app-snapshot-recovery",
      "app-snapshot-reconciliation",
      "recovery",
      "audit-retention"
    ] as const) {
      const jobSource = JSON.stringify(jobs[jobName]);
      expect(jobSource).not.toContain("secrets.LOOPGRAPH_");
    }
    expect(source).toContain("npm run --silent validate:staging > staging-validation-receipt.json");
    expect(source).toContain("npm run --silent validate:app-evidence-health-staging > app-evidence-health-staging-receipt.json");
    expect(source).toContain("npm run --silent validate:cli-session-staging > cli-session-staging-receipt.json");
    expect(source).toContain("npm run --silent validate:cli-admin-staging > cli-admin-staging-receipt.json");
    expect(source).toContain("npm run --silent validate:marketplace-release-revocation-staging > marketplace-release-revocation-staging-receipt.json");
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
        "${{ github.workspace }}/release-checkpoints/marketplace-validation-receipt.json",
      LOOPGRAPH_AUDIT_APP_EVIDENCE_HEALTH_RECEIPT_FILE:
        "${{ github.workspace }}/release-checkpoints/app-evidence-health-staging-receipt.json",
      LOOPGRAPH_AUDIT_CLI_SESSION_RECEIPT_FILE:
        "${{ github.workspace }}/release-checkpoints/cli-session-staging-receipt.json",
      LOOPGRAPH_AUDIT_CLI_ADMIN_RECEIPT_FILE:
        "${{ github.workspace }}/release-checkpoints/cli-admin-staging-receipt.json",
      LOOPGRAPH_AUDIT_MARKETPLACE_RELEASE_REVOCATION_RECEIPT_FILE:
        "${{ github.workspace }}/release-checkpoints/marketplace-release-revocation-staging-receipt.json"
    });
    expect(asNeeds(jobs["audit-retention"].needs)).toEqual([
      "app-evidence-health",
      "cli-admin",
      "cli-sessions",
      "marketplace",
      "marketplace-release-revocation",
      "staging"
    ]);
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
    const appEvidenceHealthStep = (jobs["app-evidence-health"].steps ?? []).find(
      (step) => step.run?.includes("validate:app-evidence-health-staging")
    );
    expect(asNeeds(jobs["app-evidence-health"].needs)).toEqual(["marketplace", "staging"]);
    expect(appEvidenceHealthStep?.env).toEqual({
      LOOPGRAPH_STAGING_APP_EVIDENCE_URL: "${{ needs.staging.outputs.deployment_url }}",
      LOOPGRAPH_STAGING_APP_EVIDENCE_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_STAGING_APP_EVIDENCE_PROJECT_KEY:
        "${{ needs.marketplace.outputs.project_key }}",
      LOOPGRAPH_STAGING_APP_EVIDENCE_SCHEDULE_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_APP_EVIDENCE_SCHEDULE_TOKEN_FILE }}",
      LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE }}"
    });
    expect(source).toContain('value.schemaVersion!=="hosted-app-evidence-health-staging-validation/v3"');
    expect(source).toContain("value.classificationEvidence?.cases?.length!==6");
    const cliSessionStep = (jobs["cli-sessions"].steps ?? []).find(
      (step) => step.run?.includes("validate:cli-session-staging")
    );
    expect(asNeeds(jobs["cli-sessions"].needs)).toEqual(["marketplace", "staging"]);
    expect(cliSessionStep?.env).toEqual({
      LOOPGRAPH_STAGING_CLI_PRIMARY_URL: "${{ needs.staging.outputs.deployment_url }}",
      LOOPGRAPH_STAGING_CLI_REPLICA_URL: "${{ vars.LOOPGRAPH_STAGING_CLI_REPLICA_URL }}",
      LOOPGRAPH_STAGING_CLI_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_STAGING_CLI_PROJECT_KEY: "${{ needs.marketplace.outputs.project_key }}",
      LOOPGRAPH_STAGING_CLI_REQUEST_RATE_LIMIT:
        "${{ vars.LOOPGRAPH_STAGING_CLI_REQUEST_RATE_LIMIT }}",
      LOOPGRAPH_STAGING_CLI_DISPOSABLE_REFRESH_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_CLI_DISPOSABLE_REFRESH_TOKEN_FILE }}",
      LOOPGRAPH_STAGING_CLI_SUSPENDED_ACCESS_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_CLI_SUSPENDED_ACCESS_TOKEN_FILE }}",
      LOOPGRAPH_STAGING_CLI_REVOKED_ACCESS_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_CLI_REVOKED_ACCESS_TOKEN_FILE }}",
      LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE }}"
    });
    expect(source).toContain('value.schemaVersion!=="hosted-cli-session-staging-validation/v1"');
    expect(source).toContain("value.controls?.disposableSessionRevoked!==true");
    const cliAdminStep = (jobs["cli-admin"].steps ?? []).find(
      (step) => step.run?.includes("validate:cli-admin-staging")
    );
    expect(asNeeds(jobs["cli-admin"].needs)).toEqual(["marketplace", "staging"]);
    expect(cliAdminStep?.env).toEqual({
      LOOPGRAPH_STAGING_CLI_ADMIN_URL: "${{ needs.staging.outputs.deployment_url }}",
      LOOPGRAPH_STAGING_CLI_ADMIN_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_STAGING_CLI_ADMIN_PROJECT_KEY:
        "${{ needs.marketplace.outputs.project_key }}",
      LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_SESSION_ID:
        "${{ vars.LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_SESSION_ID }}",
      LOOPGRAPH_STAGING_SUPABASE_URL: "${{ vars.LOOPGRAPH_STAGING_SUPABASE_URL }}",
      LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY }}",
      LOOPGRAPH_STAGING_CLI_ADMIN_AAL1_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_CLI_ADMIN_AAL1_SESSION_FILE }}",
      LOOPGRAPH_STAGING_CLI_ADMIN_AAL2_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_CLI_ADMIN_AAL2_SESSION_FILE }}",
      LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_ACCESS_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_CLI_ADMIN_TARGET_ACCESS_TOKEN_FILE }}",
      LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE }}"
    });
    expect(source).toContain('value.schemaVersion!=="hosted-cli-admin-staging-validation/v1"');
    expect(source).toContain("value.revocation?.correlationId!==audit?.correlationId");
    const marketplaceReleaseRevocationStep = (
      jobs["marketplace-release-revocation"].steps ?? []
    ).find((step) => step.run?.includes("validate:marketplace-release-revocation-staging"));
    expect(asNeeds(jobs["marketplace-release-revocation"].needs)).toEqual([
      "cli-admin",
      "marketplace",
      "staging"
    ]);
    expect(marketplaceReleaseRevocationStep?.env).toEqual({
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_URL:
        "${{ needs.staging.outputs.deployment_url }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_AUDIENCE:
        "${{ vars.LOOPGRAPH_STAGING_MARKETPLACE_AUDIENCE }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_ORGANIZATION_ID:
        "${{ needs.marketplace.outputs.organization_id }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_PROJECT_KEY:
        "${{ needs.marketplace.outputs.project_key }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_ID:
        "${{ vars.LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_ID }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_VERSION:
        "${{ vars.LOOPGRAPH_STAGING_RELEASE_REVOCATION_APP_VERSION }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_ARTIFACT_DIGEST:
        "${{ vars.LOOPGRAPH_STAGING_RELEASE_REVOCATION_ARTIFACT_DIGEST }}",
      LOOPGRAPH_STAGING_SUPABASE_URL: "${{ vars.LOOPGRAPH_STAGING_SUPABASE_URL }}",
      LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY:
        "${{ vars.LOOPGRAPH_STAGING_SUPABASE_PUBLISHABLE_KEY }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL1_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL1_SESSION_FILE }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL2_SESSION_FILE:
        "${{ vars.LOOPGRAPH_STAGING_RELEASE_REVOCATION_AAL2_SESSION_FILE }}",
      LOOPGRAPH_STAGING_RELEASE_REVOCATION_WORKLOAD_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_RELEASE_REVOCATION_WORKLOAD_TOKEN_FILE }}",
      LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE:
        "${{ vars.LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN_FILE }}"
    });
    expect(source).toContain(
      'value.schemaVersion!=="hosted-marketplace-release-revocation-staging-validation/v1"'
    );
    expect(source).toContain("release?.artifactDigest!==process.env.ARTIFACT_DIGEST");
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
    const learningEntityProbeStep = (jobs["learning-entities"].steps ?? []).find(
      (step) => step.run?.includes("validate:learning-entities-staging")
    );
    expect(asNeeds(jobs["learning-entities"].needs)).toEqual(["marketplace"]);
    expect(learningEntityProbeStep?.env).toEqual({
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
    expect(source.match(/LOOPGRAPH_LEARNING_ENTITY_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_EVIDENCE_HEALTH_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_CLI_SESSION_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_CLI_ADMIN_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_MARKETPLACE_RELEASE_REVOCATION_RECEIPT_FILE/g))
      .toHaveLength(2);
    expect(source.match(/name: app-evidence-health-staging-evidence/g)).toHaveLength(4);
    expect(source.match(/name: cli-session-staging-evidence/g)).toHaveLength(4);
    expect(source.match(/name: cli-admin-staging-evidence/g)).toHaveLength(4);
    expect(source.match(/name: marketplace-release-revocation-staging-evidence/g))
      .toHaveLength(4);
    expect(source.match(/name: learning-entity-staging-evidence/g)).toHaveLength(3);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_STAGING_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_RECOVERY_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_APP_SNAPSHOT_RECONCILIATION_RECEIPT_FILE/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_RELEASE_STORAGE_URL/g)).toHaveLength(2);
    expect(source.match(/LOOPGRAPH_RELEASE_SNAPSHOT_RESTORE_URL/g)).toHaveLength(2);
    expect(source.match(/^\s+LOOPGRAPH_RELEASE_EXPECTED_APP_SNAPSHOT_UNREFERENCED_INVENTORY_DIGEST:/gm))
      .toHaveLength(2);
    expect(source.match(/^\s+LOOPGRAPH_RELEASE_EXPECTED_MARKETPLACE_RELEASE_REVOCATION_ARTIFACT_DIGEST:/gm))
      .toHaveLength(2);
  });
});

function asNeeds(value: string | string[] | undefined) {
  return (typeof value === "string" ? [value] : value ?? []).slice().sort();
}
