import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { MARKETPLACE_SCHEMA_VERSION, canonicalAppDigest, connectionInstanceSchema } from "../core";
import { FileConnectorFieldMappingStore } from "./app-connector-service";
import { AppInstallationService, installPlanBlockers } from "./app-installation-service";
import { FileAppInstallationStore } from "./app-installation-store";
import { LocalAppMarketplace } from "./app-marketplace";
import { callLoopgraphAppTool } from "./app-tools";

const temporaryDirectories: string[] = [];
const packsRoot = path.resolve(process.cwd(), "packs");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function harness() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-install-"));
  temporaryDirectories.push(projectRoot);
  const marketplace = new LocalAppMarketplace(path.join(projectRoot, ".loopgraph", "marketplace"), packsRoot);
  await marketplace.refreshAllCatalogSources();
  const mappingStore = new FileConnectorFieldMappingStore(path.join(projectRoot, ".loopgraph", "apps", "field-mappings.json"), "acme");
  const logicalFields = [
    ["lead", "lead.id", "id"],
    ["lead", "lead.email", "email"],
    ["lead", "lead.company", "company"],
    ["lead", "lead.lifecycleStage", "lifecyclestage"],
    ["account", "account.id", "id"],
    ["account", "account.domain", "domain"],
    ["account", "account.customerStatus", "customer_status"]
  ] as const;
  const mappings = [];
  for (const [objectType, logicalField, providerField] of logicalFields) {
    mappings.push(await mappingStore.saveConfirmed({
      connectionId: "hubspot-production",
      objectType,
      logicalField,
      providerField,
      direction: "read",
      confidence: 1,
      confirmedBy: "admin-1"
    }));
  }
  const service = new AppInstallationService(marketplace, projectRoot, "acme", "acme-company", { mappingStore });
  const connection = connectionInstanceSchema.parse({
    schemaVersion: "connection-instance/v1alpha1",
    id: "hubspot-production",
    manifestId: "hubspot",
    capabilityKeys: ["crm.lead.read", "crm.account.read"],
    grantedScopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
    status: "connected",
    environment: "live",
    readPolicy: "read_only",
    writePolicy: "not_allowed"
  });
  return { projectRoot, service, marketplace, mappingStore, connection, mappingIds: mappings.map((mapping) => mapping.id) };
}

const installValues = {
  icpDefinition: { industries: ["software"], minimumEmployees: 50 },
  exclusions: ["existing_customer", "employee", "partner"],
  territories: { "US-WEST": "owner-1", "US-EAST": "owner-2" },
  qualificationThreshold: { qualified: 85, reviewMin: 65 },
  lifecycleStages: { new: "subscriber", qualified: "marketingqualifiedlead", accepted: "salesqualifiedlead", disqualified: "other" },
  followUpSlaMinutes: 30,
  customerFacingPolicy: "draft_only"
};

async function installSalesApp(input: Awaited<ReturnType<typeof harness>>, now = new Date("2026-08-08T12:00:00.000Z")) {
  const plan = await input.service.plan({
    projectRoot: input.projectRoot,
    workspaceId: "acme",
    companyId: "acme-company",
    appId: "loopgraph.sales.qualify-route-inbound-leads",
    versionRange: "1.0.0",
    presetId: "hubspot-gmail-slack",
    connections: [input.connection],
    installValues,
    fieldMappingIds: input.mappingIds,
    actor: "admin-1",
    now
  });
  return input.service.apply(plan, "admin-1", new Date(now.getTime() + 60_000));
}

async function addUpdateCatalog(input: Awaited<ReturnType<typeof harness>>): Promise<void> {
  const catalogRoot = path.join(input.projectRoot, "update-catalog");
  const sourcePack = path.join(packsRoot, "official", "sales", "qualify-route-inbound-leads");
  const v1 = path.join(catalogRoot, "sales", "v1");
  const v2 = path.join(catalogRoot, "sales", "v2");
  await cp(sourcePack, v1, { recursive: true });
  await cp(sourcePack, v2, { recursive: true });
  const manifestPath = path.join(v2, "loopgraph.pack.yaml");
  const manifest = YAML.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const metadata = manifest.metadata as Record<string, unknown>;
  metadata.version = "1.1.0";
  const permissions = manifest.permissions as Array<Record<string, unknown>>;
  const crmUpdate = permissions.find((permission) => permission.capability === "crm.lead.update")!;
  crmUpdate.risk = "critical";
  await writeFile(manifestPath, YAML.stringify(manifest), "utf8");
  await input.marketplace.addCatalogSource({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    id: "test-updates",
    type: "filesystem",
    uri: catalogRoot,
    enabled: true,
    trustPolicy: "explicit_local"
  });
  await input.marketplace.refreshCatalogSource("test-updates");
}

async function addConflictingObjectCatalog(input: Awaited<ReturnType<typeof harness>>): Promise<string> {
  const catalogRoot = path.join(input.projectRoot, "conflicting-object-catalog");
  const sourcePack = path.join(packsRoot, "official", "sales", "qualify-route-inbound-leads");
  const targetPack = path.join(catalogRoot, "sales", "conflicting-inbound-leads");
  await cp(sourcePack, targetPack, { recursive: true });
  const manifestPath = path.join(targetPack, "loopgraph.pack.yaml");
  const manifest = YAML.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const metadata = manifest.metadata as Record<string, unknown>;
  metadata.id = "private.sales.conflicting-inbound-leads";
  metadata.name = "Conflicting Inbound Leads";
  metadata.visibility = "private";
  const topology = manifest.topology as { objects: Array<Record<string, unknown>> };
  topology.objects[0].description = "A deliberately incompatible shared lead contract used to verify pre-install conflict review.";
  await writeFile(manifestPath, YAML.stringify(manifest), "utf8");
  await input.marketplace.addCatalogSource({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    id: "test-conflicting-objects",
    type: "filesystem",
    uri: catalogRoot,
    enabled: true,
    trustPolicy: "explicit_local"
  });
  await input.marketplace.refreshCatalogSource("test-conflicting-objects");
  return metadata.id as string;
}

describe("atomic app installation lifecycle", () => {
  it("plans, installs, tests, and activates the Sales app without enabling writes", async () => {
    const { projectRoot, service, connection, mappingIds } = await harness();
    const now = new Date("2026-08-08T12:00:00.000Z");
    const plan = await service.plan({
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      connections: [connection],
      installValues,
      fieldMappingIds: mappingIds,
      actor: "admin-1",
      now
    });
    expect(installPlanBlockers(plan)).toEqual([]);
    expect(plan.initialMode).toBe("shadow");
    expect(plan.permissions.find((permission) => permission.capability === "mail.message.send")?.decision).toBe("forbid");
    expect(plan.graphDiff.nodesAdded).toContain("app.loopgraph.sales.qualify-route-inbound-leads");
    expect(plan.graphDiff.nodesAdded).toContain("object.inbound-lead");

    const applied = await service.apply(plan, "admin-1", new Date("2026-08-08T12:05:00.000Z"));
    expect(applied.created).toBe(true);
    expect(applied.installation.state).toBe("ready_to_test");
    expect(applied.loopIds).toHaveLength(6);
    expect(applied.lock.installations[0]).toMatchObject({ appId: plan.appId, version: "1.0.0", artifactDigest: plan.artifactDigest });

    const evaluation = await service.test(applied.installation.id, "admin-1", new Date("2026-08-08T12:06:00.000Z"));
    expect(evaluation.status).toBe("passed");
    expect(evaluation.writeBlocked).toBe(true);
    expect(evaluation.scenarios.length).toBeGreaterThanOrEqual(12);

    const activationApproval = await service.approveActivation({
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "admin-1",
      reason: "Conformance passed and shadow mode keeps provider writes blocked.",
      evidenceRefs: [evaluation.id],
      now: new Date("2026-08-08T12:07:00.000Z")
    });
    const activated = await service.activate(
      applied.installation.id,
      "shadow",
      activationApproval.id,
      "admin-1",
      new Date("2026-08-08T12:08:00.000Z")
    );
    expect(activated.state).toBe("shadow");
    expect(activated.mode).toBe("shadow");
    const readiness = await service.readiness(applied.installation.id);
    expect(readiness.state).toBe("ready_for_recommend");
    expect(readiness.score).toBe(100);

    const registry = await new FileAppInstallationStore(path.join(projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(registry.activationApprovals).toContainEqual(expect.objectContaining({
      id: activationApproval.id,
      artifactDigest: applied.installation.artifactDigest,
      fromState: "simulation_passed",
      requestedMode: "shadow",
      consumedBy: "admin-1"
    }));
    expect(registry.installations).toHaveLength(1);
    expect(registry.installations[0].ownedAssets.every((asset) => asset.refCount === 1)).toBe(true);
    expect(registry.assets).toContainEqual(expect.objectContaining({
      assetId: "graph-node.object.inbound-lead",
      kind: "graph_node",
      shared: true,
      refCount: 1
    }));
    const browserStyleStatus = await callLoopgraphAppTool("loopgraph_app_install_status", {
      projectRoot,
      installationId: applied.installation.id
    }) as { installations: Array<{ workspaceId: string }> };
    expect(browserStyleStatus.installations[0].workspaceId).toBe("acme");
  });

  it("rejects missing, mismatched, expired, and replayed App activation approvals", async () => {
    const input = await harness();
    const applied = await installSalesApp(input);
    const evaluation = await input.service.test(applied.installation.id, "admin-1", new Date("2026-08-08T12:02:00.000Z"));
    expect(evaluation.status).toBe("passed");

    await expect(input.service.activate(
      applied.installation.id,
      "shadow",
      "activation-approval.missing",
      "admin-1",
      new Date("2026-08-08T12:03:00.000Z")
    )).rejects.toThrow("not found");

    const approval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "admin-1",
      reason: "Approve only the tested shadow transition.",
      evidenceRefs: [evaluation.id],
      expiresInSeconds: 60,
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    await expect(input.service.activate(
      applied.installation.id,
      "recommend",
      approval.id,
      "admin-1",
      new Date("2026-08-08T12:03:30.000Z")
    )).rejects.toThrow("does not match");
    await expect(input.service.activate(
      applied.installation.id,
      "shadow",
      approval.id,
      "admin-1",
      new Date("2026-08-08T12:04:00.000Z")
    )).rejects.toThrow("expired");

    const freshApproval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "admin-1",
      reason: "Approve the exact tested shadow transition.",
      evidenceRefs: [evaluation.id],
      now: new Date("2026-08-08T12:05:00.000Z")
    });
    await input.service.activate(
      applied.installation.id,
      "shadow",
      freshApproval.id,
      "admin-1",
      new Date("2026-08-08T12:06:00.000Z")
    );
    await expect(input.service.activate(
      applied.installation.id,
      "shadow",
      freshApproval.id,
      "admin-1",
      new Date("2026-08-08T12:06:30.000Z")
    )).rejects.toThrow("already been consumed");
  });

  it("returns an explainable read-only plan when connections, mappings, and answers are missing", async () => {
    const { projectRoot, service } = await harness();
    const plan = await service.plan({
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack",
      connections: [],
      installValues: {},
      fieldMappingIds: [],
      actor: "admin-1",
      now: new Date("2026-08-08T12:00:00.000Z")
    });
    expect(installPlanBlockers(plan)).toEqual(expect.arrayContaining([
      expect.stringContaining("icpDefinition"),
      expect.stringContaining("crm.lead.read"),
      expect.stringContaining("crm.account.read")
    ]));
    await expect(service.apply(plan, "admin-1", new Date("2026-08-08T12:05:00.000Z"))).rejects.toThrow(/not ready/i);
  });

  it("returns shared-object conflicts in the read-only plan and blocks apply", async () => {
    const input = await harness();
    await installSalesApp(input);
    const appId = await addConflictingObjectCatalog(input);
    const plan = await input.service.plan({
      projectRoot: input.projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId,
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      connections: [input.connection],
      installValues,
      fieldMappingIds: input.mappingIds,
      actor: "admin-1",
      now: new Date("2026-08-08T12:10:00.000Z")
    });

    expect(plan.conflicts).toContainEqual(expect.objectContaining({
      kind: "shared_company_object",
      resourceId: "graph-node.object.inbound-lead",
      blocking: true
    }));
    expect(plan.graphDiff.nodesReused).not.toContain("object.inbound-lead");
    expect(installPlanBlockers(plan)).toContainEqual(expect.stringContaining("shared company object conflict"));
    await expect(input.service.apply(plan, "admin-1", new Date("2026-08-08T12:11:00.000Z"))).rejects.toThrow(/not ready/i);
  });

  it("rejects tampering and expired content-bound plans", async () => {
    const { projectRoot, service, connection, mappingIds } = await harness();
    const plan = await service.plan({
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack",
      connections: [connection],
      installValues,
      fieldMappingIds: mappingIds,
      actor: "admin-1",
      now: new Date("2026-08-08T12:00:00.000Z")
    });
    await expect(service.apply({ ...plan, presetId: "salesforce-outlook-teams" }, "admin-1", new Date("2026-08-08T12:05:00.000Z"))).rejects.toThrow(/digest/i);
    await expect(service.apply(plan, "admin-1", new Date("2026-08-08T13:00:00.000Z"))).rejects.toThrow(/expired/i);
  });

  it("runs bounded historical replay, records human judgments, and recommends without auto-promoting", async () => {
    const { projectRoot, service, connection, mappingIds } = await harness();
    const plan = await service.plan({
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      connections: [connection],
      installValues,
      fieldMappingIds: mappingIds,
      actor: "admin-1",
      now: new Date("2026-08-08T12:00:00.000Z")
    });
    const applied = await service.apply(plan, "admin-1", new Date("2026-08-08T12:01:00.000Z"));
    await service.test(applied.installation.id, "admin-1", new Date("2026-08-08T12:02:00.000Z"));

    const replay = await service.historicalReplay({
      schemaVersion: "loopgraph-app-eval/v1alpha1",
      installationId: applied.installation.id,
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-08T12:00:00.000Z",
      maxEvents: 3,
      requestedAt: "2026-08-08T12:03:00.000Z",
      requestedBy: "admin-1",
      events: [
        {
          id: "historical-high-fit",
          occurredAt: "2026-08-02T09:00:00.000Z",
          source: "hubspot",
          eventType: "lead.created",
          subject: { type: "lead", id: "lead-historical-1" },
          normalizedPayload: { leadId: "lead-historical-1", email: "buyer@example.test", company: "Example" },
          evidenceRefs: ["evidence:historical:1"],
          connectorState: "connected",
          expectedAction: "route",
          expectedLoopId: "sales-inbound-lead-intake"
        },
        {
          id: "historical-ambiguous",
          occurredAt: "2026-08-03T09:00:00.000Z",
          source: "loopgraph",
          eventType: "lead.intake_ready",
          subject: { type: "account", id: "account-historical-2" },
          normalizedPayload: { accountId: "account-historical-2", domain: "shared.test", candidateAccountIds: ["a", "b"] },
          evidenceRefs: ["evidence:historical:2"],
          connectorState: "connected",
          expectedAction: "request_human"
        },
        {
          id: "historical-connector-down",
          occurredAt: "2026-08-04T09:00:00.000Z",
          source: "loopgraph",
          eventType: "lead.qualified",
          subject: { type: "lead", id: "lead-historical-3" },
          normalizedPayload: { leadId: "lead-historical-3", qualification: { score: 92 }, territoryRules: { west: "owner-1" } },
          evidenceRefs: ["evidence:historical:3"],
          connectorState: "unavailable",
          expectedAction: "defer",
          expectedLoopId: "sales-inbound-lead-routing"
        }
      ]
    }, new Date("2026-08-08T12:04:00.000Z"));

    expect(replay).toMatchObject({ level: "historical_replay", status: "passed", replay: true, writeBlocked: true });
    expect(replay.metrics).toMatchObject({ eventCount: 3, routed: 1, abstained: 1, deferred: 1, providerWrites: 0 });
    for (const scenario of replay.scenarios) {
      await service.labelEvaluation({
        schemaVersion: "loopgraph-app-eval/v1alpha1",
        runId: replay.id,
        scenarioId: scenario.id,
        label: "correct",
        reviewMinutes: 1,
        reviewedBy: "sales-manager",
        reviewedAt: "2026-08-08T12:05:00.000Z"
      });
    }
    const recommendation = await service.promotionRecommendation(applied.installation.id, new Date("2026-08-08T12:06:00.000Z"));
    expect(recommendation).toMatchObject({
      recommendedMode: "recommend",
      canAutoPromote: false,
      falsePositiveRate: 0,
      incompleteRate: 0,
      estimatedReviewMinutes: 3
    });
    expect(recommendation.requiredApprovals).toEqual(["app_owner", "promotion_approver"]);
    const registry = await new FileAppInstallationStore(path.join(projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(registry.installations[0].state).toBe("simulation_passed");
  });

  it("configures, overlays, repairs, duplicates, detaches, and ownership-safely uninstalls apps", async () => {
    const input = await harness();
    const applied = await installSalesApp(input);
    const configured = await input.service.configure({
      installationId: applied.installation.id,
      values: { followUpSlaMinutes: 45 },
      expectedConfigurationDigest: canonicalAppDigest(applied.installation.configuration),
      actor: "sales-admin",
      now: new Date("2026-08-08T12:02:00.000Z")
    });
    expect(configured.installation).toMatchObject({ state: "ready_to_test", mode: "simulation" });
    expect(configured.installation?.configuration.values.followUpSlaMinutes).toBe(45);

    const overlaid = await input.service.applyOverlay({
      installationId: applied.installation.id,
      operations: [{ op: "set", path: "/values/qualificationThreshold", value: { qualified: 90, reviewMin: 70 } }],
      expectedArtifactDigest: applied.installation.artifactDigest,
      expectedOverlayRevision: 0,
      actor: "sales-admin",
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    expect(overlaid.installation?.overlay?.revision).toBe(1);
    expect(overlaid.receipt.action).toBe("overlay");

    const repaired = await input.service.repair(applied.installation.id, "sales-admin", new Date("2026-08-08T12:04:00.000Z"));
    expect(repaired.installation).toMatchObject({ state: "ready_to_test", mode: "simulation" });
    expect(repaired.receipt.action).toBe("repair");

    const duplicated = await input.service.duplicate({
      installationId: applied.installation.id,
      derivedAppId: "private.sales.acme-lead-qualification",
      overlayOperations: [{ op: "set", path: "/values/followUpSlaMinutes", value: 15 }],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:05:00.000Z")
    });
    expect(duplicated.installation?.id).not.toBe(applied.installation.id);
    expect(duplicated.installation?.derivation).toMatchObject({
      derivedAppId: "private.sales.acme-lead-qualification",
      parentInstallationId: applied.installation.id
    });
    expect(duplicated.installation?.ownedAssets.every((asset) => asset.ownerInstallationIds.includes(duplicated.installation!.id))).toBe(true);

    const detached = await input.service.detach(
      duplicated.installation!.id,
      duplicated.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T12:06:00.000Z")
    );
    expect(detached.installation?.derivation?.snapshotPath).toContain("private-snapshots");
    expect(detached.installation?.derivation?.detachedAt).toBe("2026-08-08T12:06:00.000Z");

    const uninstalled = await input.service.uninstall({
      installationId: applied.installation.id,
      expectedArtifactDigest: applied.installation.artifactDigest,
      actor: "sales-admin",
      reason: "Replace the upstream installation with the reviewed private variant.",
      confirmed: true,
      now: new Date("2026-08-08T12:07:00.000Z")
    });
    expect(uninstalled.installation).toBeUndefined();
    expect(uninstalled.receipt).toMatchObject({ action: "uninstall", evidenceRetained: true, reversible: false });
    const registry = await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(registry.installations.map((installation) => installation.id)).toEqual([duplicated.installation!.id]);
    expect(registry.lifecycleReceipts.map((receipt) => receipt.action)).toEqual(expect.arrayContaining([
      "configure", "overlay", "repair", "duplicate", "detach", "uninstall"
    ]));
    expect(await input.mappingStore.list()).toHaveLength(input.mappingIds.length);
  });

  it("plans permission-aware updates, requires review, and restores the exact prior revision", async () => {
    const input = await harness();
    const applied = await installSalesApp(input);
    await addUpdateCatalog(input);
    const updatePlan = await input.service.planUpdate({
      installationId: applied.installation.id,
      versionRange: "1.1.0",
      connections: [input.connection],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:02:00.000Z")
    });
    expect(updatePlan).toMatchObject({ fromVersion: "1.0.0", toVersion: "1.1.0", permissionReviewRequired: true });
    expect(updatePlan.permissionChanges).toContainEqual(expect.objectContaining({
      capability: "crm.lead.update",
      change: "risk_increased",
      requiresReview: true
    }));
    await expect(input.service.applyUpdate({
      plan: updatePlan,
      actor: "sales-admin",
      now: new Date("2026-08-08T12:03:00.000Z")
    })).rejects.toThrow(/explicit review/i);

    const updated = await input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    expect(updated.installation).toMatchObject({ version: "1.1.0", state: "ready_to_test", mode: "simulation" });
    expect(updated.installation?.history.at(-1)).toMatchObject({ version: "1.0.0", reason: "update" });

    const rolledBack = await input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T12:04:00.000Z")
    );
    expect(rolledBack.installation).toMatchObject({ version: "1.0.0", state: "rolled_back", mode: "simulation" });
    const conformance = await input.service.test(applied.installation.id, "sales-admin", new Date("2026-08-08T12:05:00.000Z"));
    expect(conformance.status).toBe("passed");
  });
});
