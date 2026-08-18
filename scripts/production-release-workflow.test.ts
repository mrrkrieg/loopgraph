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
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
};

describe("staging release workflow contract", () => {
  it("requires all four protected receipts before an attested manifest can be promoted", async () => {
    const source = await readFile(".github/workflows/staging-release.yml", "utf8");
    const workflow = parse(source) as { jobs: Record<string, WorkflowJob> };
    const jobs = workflow.jobs;

    expect(jobs.marketplace.environment).toBe("marketplace-staging");
    expect(jobs.recovery.environment).toBe("recovery-staging");
    expect(jobs["audit-retention"].environment).toBe("audit-retention-staging");
    expect(jobs.evidence.environment).toBe("release-evidence");
    expect(jobs.promote.environment).toBe("production");
    expect(asNeeds(jobs.evidence.needs)).toEqual([
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

    for (const jobName of ["marketplace", "recovery", "audit-retention"] as const) {
      const jobSource = JSON.stringify(jobs[jobName]);
      expect(jobSource).not.toContain("secrets.LOOPGRAPH_");
    }
    expect(source).toContain("npm run --silent validate:staging > staging-validation-receipt.json");
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
    expect(source.match(/LOOPGRAPH_RELEASE_AUDIT_RETENTION_PUBLIC_KEY_PEM/g)).toHaveLength(2);
  });
});

function asNeeds(value: string | string[] | undefined) {
  return (typeof value === "string" ? [value] : value ?? []).slice().sort();
}
