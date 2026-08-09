import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionInstanceSchema } from "../core";
import { FileConnectorFieldMappingStore } from "./app-connector-service";
import { AppInstallationService, installPlanBlockers } from "./app-installation-service";
import { FileAppInstallationStore } from "./app-installation-store";
import { LocalAppMarketplace } from "./app-marketplace";

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
  return { projectRoot, service, connection, mappingIds: mappings.map((mapping) => mapping.id) };
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

    const applied = await service.apply(plan, "admin-1", new Date("2026-08-08T12:05:00.000Z"));
    expect(applied.created).toBe(true);
    expect(applied.installation.state).toBe("ready_to_test");
    expect(applied.loopIds).toHaveLength(6);
    expect(applied.lock.installations[0]).toMatchObject({ appId: plan.appId, version: "1.0.0", artifactDigest: plan.artifactDigest });

    const evaluation = await service.test(applied.installation.id, "admin-1", new Date("2026-08-08T12:06:00.000Z"));
    expect(evaluation.status).toBe("passed");
    expect(evaluation.writeBlocked).toBe(true);
    expect(evaluation.scenarios.length).toBeGreaterThanOrEqual(12);

    const activated = await service.activate(applied.installation.id, "shadow", "admin-1");
    expect(activated.state).toBe("shadow");
    expect(activated.mode).toBe("shadow");
    const readiness = await service.readiness(applied.installation.id);
    expect(readiness.state).toBe("ready_for_recommend");
    expect(readiness.score).toBe(100);

    const registry = await new FileAppInstallationStore(path.join(projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(registry.installations).toHaveLength(1);
    expect(registry.installations[0].ownedAssets.every((asset) => asset.refCount === 1)).toBe(true);
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
});

