import { describe, expect, it } from "vitest";
import {
  APP_CONFIGURATION_SCHEMA_VERSION,
  APP_EVAL_SCHEMA_VERSION,
  APP_INSTALL_SCHEMA_VERSION,
  LOOP_PACK_SCHEMA_VERSION,
  appEvalRunSchema,
  appHistoricalReplayRequestSchema,
  appInstallPlanSchema,
  appInstallationLockSchema,
  appPlatformJsonSchemas,
  assertSafeInitialRollout,
  canonicalAppDigest,
  loopPackManifestSchema
} from "./app-platform";

const now = "2026-08-08T12:00:00.000Z";
const later = "2026-08-08T13:00:00.000Z";
const digest = (value: string) => canonicalAppDigest(value);

function manifestInput() {
  return {
    schemaVersion: LOOP_PACK_SCHEMA_VERSION,
    kind: "LoopPack",
    metadata: {
      id: "loopgraph.sales.inbound-leads",
      name: "Qualify and Route Inbound Leads",
      version: "1.0.0",
      summary: "Qualify inbound demand and route it safely.",
      description: "A complete Sales application for governed lead intake, research, qualification, routing, follow-up, and learning.",
      department: "sales",
      publisher: { id: "loopgraph", name: "Loopgraph", verified: true },
      license: "MIT",
      visibility: "official",
      tags: ["sales", "inbound"]
    },
    compatibility: {
      loopgraph: ">=0.2.0 <1.0.0",
      hermes: ">=1.0.0",
      platforms: ["darwin", "linux", "win32"]
    },
    dependencies: [],
    modules: [],
    presets: [{
      id: "hubspot-gmail-slack",
      name: "HubSpot + Gmail + Slack",
      description: "The default inbound Sales stack.",
      path: "presets/hubspot-gmail-slack.yaml",
      providerFamily: "hubspot"
    }],
    permissions: [{
      capability: "crm.lead.read",
      authority: "read",
      mode: "required",
      risk: "low",
      purpose: "Read new leads and qualification context.",
      customerFacing: false,
      defaultPolicy: "allowed",
      dataClasses: ["business_contact"]
    }],
    requiredCapabilities: ["crm.lead.read"],
    optionalCapabilities: [],
    entrypoints: {
      loops: ["loops/lead-intake.yaml"],
      skills: ["skills/icp-evaluation.yaml"],
      connectors: ["connectors/hubspot.yaml"],
      setup: ["setup/questions.yaml"],
      policies: ["policies/default.yaml"],
      fixtures: ["fixtures/high-fit.json"],
      evals: ["evals/conformance.yaml"],
      dashboards: [],
      assets: []
    },
    ownership: { defaultOwnerRole: "sales_operations", reviewRoles: ["sales_manager"] },
    defaultRolloutMode: "shadow"
  } as const;
}

describe("Loopgraph App Platform contracts", () => {
  it("accepts a valid strict LoopPack manifest and rejects unknown fields", () => {
    const parsed = loopPackManifestSchema.parse(manifestInput());
    expect(parsed.metadata.id).toBe("loopgraph.sales.inbound-leads");

    expect(() => loopPackManifestSchema.parse({ ...manifestInput(), executable: "postinstall.js" })).toThrow();
    expect(() => loopPackManifestSchema.parse({
      ...manifestInput(),
      metadata: { ...manifestInput().metadata, accessToken: "secret" }
    })).toThrow();
  });

  it("forbids packs from enabling provider execution", () => {
    const input = manifestInput();
    expect(() => loopPackManifestSchema.parse({
      ...input,
      permissions: [{
        capability: "crm.lead.update",
        authority: "execute",
        mode: "optional",
        risk: "high",
        purpose: "Update a CRM lead.",
        customerFacing: false,
        defaultPolicy: "allowed",
        dataClasses: []
      }],
      requiredCapabilities: ["crm.lead.update"]
    })).toThrow(/cannot be enabled/i);
  });

  it("produces order-independent canonical digests", () => {
    expect(canonicalAppDigest({ a: 1, b: 2 })).toBe(canonicalAppDigest({ b: 2, a: 1 }));
    expect(canonicalAppDigest({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("binds an install plan to its exact content and rejects direct execution", () => {
    const base = {
      schemaVersion: APP_INSTALL_SCHEMA_VERSION,
      id: "plan.sales.inbound",
      workspaceId: "acme",
      appId: "loopgraph.sales.inbound-leads",
      version: "1.0.0",
      artifactDigest: digest("artifact"),
      selectedModules: [],
      presetId: "hubspot-gmail-slack",
      dependencyResolutions: [],
      capabilityResolutions: [{
        capability: "crm.lead.read",
        required: true,
        connectionId: "hubspot.production",
        recipeId: "hubspot.crm",
        status: "connected"
      }],
      missingConfigurationKeys: [],
      configuration: {
        schemaVersion: APP_CONFIGURATION_SCHEMA_VERSION,
        appId: "loopgraph.sales.inbound-leads",
        version: "1.0.0",
        fields: [],
        values: {},
        provenance: {},
        completedAt: now
      },
      fieldMappingIds: ["mapping.hubspot.lead-email"],
      permissions: [{
        capability: "crm.lead.read",
        authority: "read",
        decision: "allow",
        reason: "Required to qualify inbound leads.",
        changedFromInstalled: false
      }],
      assets: [{
        id: "loop.sales.lead-intake",
        kind: "loop_spec",
        action: "create",
        digest: digest("lead-intake"),
        shared: false,
        sourcePath: "loops/lead-intake.yaml",
        dependencies: []
      }],
      graphDiff: {
        nodesAdded: ["app.sales.inbound"],
        nodesReused: ["department.sales"],
        edgesAdded: ["edge.sales.inbound"],
        edgesRemoved: []
      },
      requiredTests: ["high-fit", "ambiguous-account"],
      initialMode: "shadow",
      rollback: { removeStagedAssets: true, preserveSharedAssets: true },
      createdAt: now,
      expiresAt: later
    } as const;
    const planDigest = canonicalAppDigest({ ...base, planDigest: undefined });
    const plan = appInstallPlanSchema.parse({ ...base, planDigest });
    expect(plan.planDigest).toBe(planDigest);
    expect(() => appInstallPlanSchema.parse({ ...base, planDigest, presetId: "salesforce-outlook-teams" })).toThrow(/digest/i);
    expect(() => appInstallPlanSchema.parse({
      ...base,
      planDigest: canonicalAppDigest({
        ...base,
        permissions: [{
          capability: "crm.lead.update",
          authority: "execute",
          decision: "allow",
          reason: "Unsafe",
          changedFromInstalled: false
        }],
        planDigest: undefined
      }),
      permissions: [{
        capability: "crm.lead.update",
        authority: "execute",
        decision: "allow",
        reason: "Unsafe",
        changedFromInstalled: false
      }]
    })).toThrow(/cannot enable provider execution/i);
  });

  it("binds lockfiles to their installation set", () => {
    const base = {
      schemaVersion: APP_INSTALL_SCHEMA_VERSION,
      workspaceId: "acme",
      revision: 1,
      installations: [{
        installationId: "install.sales.inbound",
        appId: "loopgraph.sales.inbound-leads",
        version: "1.0.0",
        artifactDigest: digest("artifact"),
        configurationDigest: digest("configuration"),
        selectedModules: []
      }],
      generatedAt: now
    } as const;
    const lockDigest = canonicalAppDigest({ ...base, lockDigest: undefined });
    expect(appInstallationLockSchema.parse({ ...base, lockDigest }).revision).toBe(1);
    expect(() => appInstallationLockSchema.parse({ ...base, lockDigest, revision: 2 })).toThrow(/digest/i);
  });

  it("requires historical replay to be read-only and explicitly labeled", () => {
    const base = {
      schemaVersion: APP_EVAL_SCHEMA_VERSION,
      id: "eval.sales.history",
      installationId: "install.sales.inbound",
      appId: "loopgraph.sales.inbound-leads",
      appVersion: "1.0.0",
      artifactDigest: digest("artifact"),
      level: "historical_replay",
      status: "passed",
      replay: true,
      writeBlocked: true,
      startedAt: now,
      completedAt: later,
      scenarios: [],
      metrics: {},
      evidenceRefs: []
    } as const;
    expect(appEvalRunSchema.parse(base).writeBlocked).toBe(true);
    expect(() => appEvalRunSchema.parse({ ...base, writeBlocked: false })).toThrow(/block all writes/i);
  });

  it("bounds historical replay by time window, event count, and event occurrence", () => {
    const request = {
      schemaVersion: APP_EVAL_SCHEMA_VERSION,
      installationId: "install.sales.inbound",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-08T00:00:00.000Z",
      maxEvents: 1,
      requestedAt: now,
      requestedBy: "sales-manager",
      events: [{
        id: "historical-event-1",
        occurredAt: "2026-08-02T00:00:00.000Z",
        source: "hubspot",
        eventType: "lead.created",
        subject: { type: "lead", id: "lead-1" },
        normalizedPayload: {},
        evidenceRefs: [],
        connectorState: "connected"
      }]
    } as const;
    expect(appHistoricalReplayRequestSchema.parse(request).events).toHaveLength(1);
    expect(() => appHistoricalReplayRequestSchema.parse({
      ...request,
      to: "2026-12-01T00:00:00.000Z"
    })).toThrow(/90-day/i);
    expect(() => appHistoricalReplayRequestSchema.parse({
      ...request,
      events: [{ ...request.events[0], occurredAt: "2026-07-01T00:00:00.000Z" }]
    })).toThrow(/outside/i);
  });

  it("exports the public schemas as JSON Schema", () => {
    const schemas = appPlatformJsonSchemas();
    expect(Object.keys(schemas)).toContain("LoopPackManifest");
    expect(Object.keys(schemas)).toContain("AppUpdatePlan");
    expect(Object.keys(schemas)).toEqual(expect.arrayContaining([
      "AppHistoricalReplayRequest",
      "AppEvalJudgment",
      "AppPromotionRecommendation"
    ]));
    expect(JSON.stringify(schemas.LoopPackManifest)).toContain("loopgraph-pack/v1alpha1");
  });

  it("only permits safe initial rollout modes", () => {
    expect(() => assertSafeInitialRollout("simulation")).not.toThrow();
    expect(() => assertSafeInitialRollout("shadow")).not.toThrow();
    expect(() => assertSafeInitialRollout("live")).toThrow(/must begin/i);
  });
});
