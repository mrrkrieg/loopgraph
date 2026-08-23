import { describe, expect, it } from "vitest";
import {
  APP_CONFIGURATION_SCHEMA_VERSION,
  APP_ACTIVATION_GATE_SCHEMA_VERSION,
  APP_EVAL_SCHEMA_VERSION,
  APP_INSTALL_SCHEMA_VERSION,
  APP_OPERATION_ACTION_SCHEMA_VERSION,
  APP_MATURITY_EVIDENCE_SCHEMA_VERSION,
  LOOP_PACK_SCHEMA_VERSION,
  appActivationGateSchema,
  appEvalRunSchema,
  appHistoricalReplayRequestSchema,
  appInstallPlanSchema,
  appOnboardingDraftSchema,
  appOperationActionSchema,
  appInstallationLockSchema,
  appMaturityEvidenceSchema,
  appPlatformJsonSchemas,
  assertSafeInitialRollout,
  canonicalAppDigest,
  loopPackSignatureSchema,
  marketplaceCatalogSourceSchema,
  loopPackManifestSchema,
  providerSchemaSnapshotSchema
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
  it("bounds resumable onboarding drafts and rejects ambiguous snapshots", () => {
    const draft = {
      schemaVersion: "loopgraph-app-onboarding-draft/v1alpha1",
      id: "draft.sales-inbound",
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      selectedModules: ["qualification"],
      configuration: { exclusions: ["employee"] },
      fieldMappingIds: ["mapping.hubspot.lead-email"],
      revision: 1,
      createdAt: now,
      createdBy: "sales-operations",
      updatedAt: later,
      updatedBy: "sales-operations"
    };
    expect(appOnboardingDraftSchema.parse(draft).revision).toBe(1);
    expect(() => appOnboardingDraftSchema.parse({
      ...draft,
      selectedModules: ["qualification", "qualification"]
    })).toThrow(/unique/i);
    expect(() => appOnboardingDraftSchema.parse({
      ...draft,
      fieldMappingIds: ["mapping.hubspot.lead-email", "mapping.hubspot.lead-email"]
    })).toThrow(/unique/i);
    expect(() => appOnboardingDraftSchema.parse({
      ...draft,
      configuration: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`answer_${index}`, index]))
    })).toThrow(/20 declared answers/i);
    expect(() => appOnboardingDraftSchema.parse({
      ...draft,
      updatedAt: "2026-08-08T11:00:00.000Z"
    })).toThrow(/cannot precede creation/i);
  });

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

  it("requires topology references and supporting fan-out to be explicit", () => {
    const input = manifestInput();
    const topology = {
      objects: [{
        id: "lead",
        objectType: "lead",
        label: "Lead",
        description: "A resolved lead identity.",
        shared: true,
        identityKeys: ["leadId"]
      }],
      flows: [{
        id: "lead-enters-intake",
        source: { kind: "object", id: "lead" },
        target: { kind: "loop", id: "sales-inbound-lead-intake" },
        type: "evidence_in",
        reason: "A resolved lead can enter intake."
      }]
    } as const;
    expect(loopPackManifestSchema.parse({ ...input, topology }).topology.flows).toHaveLength(1);
    expect(() => loopPackManifestSchema.parse({
      ...input,
      topology: {
        objects: topology.objects,
        flows: [{
          id: "unsafe-fanout",
          source: { kind: "loop", id: "sales-inbound-lead-intake" },
          target: { kind: "loop", id: "sales-inbound-lead-routing" },
          type: "supports",
          reason: "Fan out without proving when it is safe."
        }]
      }
    })).toThrow(/evidence condition/i);
  });

  it("produces order-independent canonical digests", () => {
    expect(canonicalAppDigest({ a: 1, b: 2 })).toBe(canonicalAppDigest({ b: 2, a: 1 }));
    expect(canonicalAppDigest({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("binds a prepared provider action to one App route without accepting provider input", () => {
    const base = {
      schemaVersion: APP_OPERATION_ACTION_SCHEMA_VERSION,
      id: "appact_12345678",
      workspaceId: "acme",
      companyId: "acme-company",
      installationId: "installed-sales",
      appId: "loopgraph.sales.inbound-leads",
      artifactDigest: digest("artifact"),
      loopId: "sales-inbound-lead-intake",
      loopVersionHash: digest("loop"),
      capability: "crm.lead.write",
      routeJobId: "route-job-1",
      agentInstanceId: "hermes-sales",
      callId: "call-1",
      requestId: "request-12345678",
      idempotencyKey: "idempotency-12345678",
      resolutionDigest: digest("resolution"),
      executionDigest: digest("execution"),
      providerBinding: {
        providerId: "hubspot",
        connectionId: "hubspot-production",
        brokerCapability: "provider.action.execute" as const,
        operation: "crm.contacts.update"
      },
      companyObject: { type: "lead", identityDigest: digest("lead-42") },
      environment: "production" as const,
      brokerPreparedActionId: "broker-action-12345678",
      brokerPreparedActionFingerprint: "f".repeat(64),
      brokerPrepareReceiptId: "broker-receipt-12345678",
      approvalRequired: true,
      riskClass: "write" as const,
      status: "prepared" as const,
      preparedAt: now,
      expiresAt: later,
      updatedAt: now
    };
    const action = appOperationActionSchema.parse({
      ...base,
      recordDigest: canonicalAppDigest({ ...base, recordDigest: undefined })
    });
    expect(action.companyObject).not.toHaveProperty("id");
    expect(() => appOperationActionSchema.parse({ ...action, input: { email: "person@example.com" } })).toThrow();
    expect(() => appOperationActionSchema.parse({ ...action, loopId: "another-loop" })).toThrow(/digest/i);
  });

  it("binds tested maturity to complete zero-write evidence for one exact artifact", () => {
    const body = {
      schemaVersion: APP_MATURITY_EVIDENCE_SCHEMA_VERSION,
      artifactDigest: digest("app"),
      basis: "synthetic_conformance" as const,
      status: "passed" as const,
      writeBlocked: true as const,
      providerWrites: 0,
      scenarioCount: 13,
      passedScenarioCount: 13,
      evidenceRefs: ["eval-suite:required-safety"],
      evaluatedAt: now
    };
    const evidence = appMaturityEvidenceSchema.parse({
      ...body,
      evidenceDigest: canonicalAppDigest({ ...body, evidenceDigest: undefined })
    });
    expect(evidence.status).toBe("passed");
    expect(() => appMaturityEvidenceSchema.parse({ ...evidence, providerWrites: 1 })).toThrow();
    expect(() => appMaturityEvidenceSchema.parse({ ...evidence, scenarioCount: 12, passedScenarioCount: 12 })).toThrow(/13 safety categories/i);
    expect(() => appMaturityEvidenceSchema.parse({ ...evidence, evidenceDigest: digest("tampered") })).toThrow(/digest/i);
  });

  it("requires signed catalogs to carry exact publisher trust material instead of a key label alone", () => {
    const signature = loopPackSignatureSchema.parse({
      schemaVersion: "loopgraph-pack-signature/v1alpha1",
      publisherId: "acme",
      digest: digest("pack"),
      algorithm: "ed25519",
      keyId: "acme.release.primary",
      publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA000000000000000000000000000000000000000=\n-----END PUBLIC KEY-----",
      value: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      signedAt: now
    });
    expect(signature.keyId).toBe("acme.release.primary");
    const source = marketplaceCatalogSourceSchema.parse({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "acme.private",
      type: "filesystem",
      uri: "file:///catalog",
      enabled: true,
      trustPolicy: "signed",
      trustedPublisherKeys: [{
        publisherId: signature.publisherId,
        keyId: signature.keyId,
        algorithm: signature.algorithm,
        publicKey: signature.publicKey
      }]
    });
    expect(source.trustedPublisherKeys[0]).toMatchObject({ publisherId: "acme", keyId: "acme.release.primary" });
    expect(source).not.toHaveProperty("trustedKeyIds");
  });

  it("accepts only explicitly redacted, connection-bound provider schema samples", () => {
    const snapshot = {
      schemaVersion: "loopgraph-provider-schema/v1alpha1",
      workspaceId: "acme",
      connectionId: "hubspot-production",
      providerId: "hubspot",
      source: "provider_api",
      samplePolicy: "redacted_only",
      objects: [{
        objectType: "lead",
        fields: [{ name: "email", label: "Email", type: "string", writable: true, sampleValues: ["masked@example.com"] }]
      }],
      inspectedAt: now,
      expiresAt: later,
      inspectedBy: "hermes-connector"
    } as const;
    expect(providerSchemaSnapshotSchema.parse(snapshot).samplePolicy).toBe("redacted_only");
    expect(() => providerSchemaSnapshotSchema.parse({ ...snapshot, samplePolicy: "raw" })).toThrow();
    expect(() => providerSchemaSnapshotSchema.parse({
      ...snapshot,
      objects: [{ objectType: "lead", fields: [snapshot.objects[0].fields[0], snapshot.objects[0].fields[0]] }]
    })).toThrow(/unique/i);
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
      conflicts: [],
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
      "AppPromotionRecommendation",
      "AppOnboardingDraft",
      "AppOnboardingResetResult",
      "AppActivationGate",
      "AppOperationAction",
      "AppOperationActionEvent",
      "AppOperationActionCommitResult"
    ]));
    expect(JSON.stringify(schemas.LoopPackManifest)).toContain("loopgraph-pack/v1alpha1");
  });

  it("binds activation readiness to a canonical, internally consistent gate digest", () => {
    const gateContent = {
      schemaVersion: APP_ACTIVATION_GATE_SCHEMA_VERSION,
      installationId: "install.sales-inbound",
      appId: "loopgraph.sales.inbound-leads",
      artifactDigest: digest("sales-inbound-artifact"),
      fromState: "shadow" as const,
      requestedMode: "recommend" as const,
      status: "ready" as const,
      requiredMaturity: "connected" as const,
      observedMaturity: "connected" as const,
      checks: [
        { id: "ordered-lifecycle", status: "pass" as const, summary: "The transition is ordered.", evidenceRefs: [] },
        { id: "operational-maturity", status: "pass" as const, summary: "Connected maturity is achieved.", evidenceRefs: ["evaluation:synthetic"] },
        { id: "promotion-evidence", status: "pass" as const, summary: "Historical decisions are reviewed.", evidenceRefs: ["evaluation:replay"] },
        { id: "permission-boundary", status: "pass" as const, summary: "Writes remain blocked.", evidenceRefs: [] }
      ],
      evidenceRefs: ["evaluation:synthetic", "evaluation:replay"],
      evaluatedAt: now
    };
    const gate = appActivationGateSchema.parse({
      ...gateContent,
      gateDigest: canonicalAppDigest(gateContent)
    });
    expect(gate.status).toBe("ready");
    expect(() => appActivationGateSchema.parse({ ...gate, observedMaturity: "concept" })).toThrow(/digest/i);
    expect(() => appActivationGateSchema.parse({
      ...gate,
      status: "ready",
      checks: gate.checks.map((check) => check.id === "promotion-evidence" ? { ...check, status: "blocked" } : check),
      gateDigest: canonicalAppDigest({
        ...gate,
        status: "ready",
        checks: gate.checks.map((check) => check.id === "promotion-evidence" ? { ...check, status: "blocked" } : check),
        gateDigest: undefined
      })
    })).toThrow(/status must be blocked/i);
  });

  it("only permits safe initial rollout modes", () => {
    expect(() => assertSafeInitialRollout("simulation")).not.toThrow();
    expect(() => assertSafeInitialRollout("shadow")).not.toThrow();
    expect(() => assertSafeInitialRollout("live")).toThrow(/must begin/i);
  });
});
