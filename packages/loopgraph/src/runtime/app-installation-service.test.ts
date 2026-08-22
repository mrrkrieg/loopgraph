import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { MARKETPLACE_SCHEMA_VERSION, canonicalAppDigest, connectionInstanceSchema } from "../core";
import { FileConnectorFieldMappingStore, type ConnectorFieldMappingStore } from "./app-connector-service";
import { FileCompanyContextStore } from "./company-context-service";
import { AppInstallationService, installPlanBlockers } from "./app-installation-service";
import {
  FileAppInstallationStore,
  appInstallationRegistrySchema,
  assertAppInstallationRegistryRevision,
  emptyAppInstallationRegistry,
  type AppInstallationMutationAuditContext,
  type AppInstallationRegistry,
  type AppInstallationStore,
  type AppInstallationUpdate,
  type AppLifecycleOperation
} from "./app-installation-store";
import { LocalAppMarketplace } from "./app-marketplace";
import { callLoopgraphAppTool } from "./app-tools";
import { FileLoopSpecRegistryStore } from "./loop-spec-store";
import { readLoopgraphWorkspace } from "./workspace";

const temporaryDirectories: string[] = [];
const packsRoot = path.resolve(process.cwd(), "packs");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function harness(options: { installationStore?: AppInstallationStore } = {}) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-install-"));
  temporaryDirectories.push(projectRoot);
  const marketplace = new LocalAppMarketplace(path.join(projectRoot, ".loopgraph", "marketplace"), packsRoot);
  await marketplace.refreshAllCatalogSources();
  const mappingStore = new FileConnectorFieldMappingStore(path.join(projectRoot, ".loopgraph", "apps", "field-mappings.json"), "acme");
  const contextStore = new FileCompanyContextStore(path.join(projectRoot, ".loopgraph", "apps", "company-context.json"));
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
  const service = new AppInstallationService(marketplace, projectRoot, "acme", "acme-company", {
    contextStore,
    mappingStore,
    installationStore: options.installationStore
  });
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
  return { projectRoot, service, marketplace, contextStore, mappingStore, connection, mappingIds: mappings.map((mapping) => mapping.id) };
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

class AuditCapturingInstallationStore implements AppInstallationStore {
  readonly persistence = "file" as const;
  readonly audits: AppInstallationMutationAuditContext[] = [];
  private registry: AppInstallationRegistry;
  private interruptedCompletionAction?: AppLifecycleOperation["action"];

  constructor(workspaceId: string) {
    this.registry = emptyAppInstallationRegistry(workspaceId);
  }

  async read() {
    return this.registry;
  }

  async readLockfile() {
    return undefined;
  }

  interruptNextActivationRegistryCommit(): void {
    this.interruptNextLifecycleRegistryCommit("activate");
  }

  interruptNextLifecycleRegistryCommit(action: AppLifecycleOperation["action"]): void {
    this.interruptedCompletionAction = action;
  }

  async withExclusiveUpdate<T>(operation: (registry: AppInstallationRegistry) => Promise<AppInstallationUpdate<T>>): Promise<T> {
    const current = this.registry;
    const result = await operation(current);
    const next = appInstallationRegistrySchema.parse(result.registry);
    assertAppInstallationRegistryRevision(current, next);
    const pendingOperation = current.lifecycleOperations.find((candidate) =>
      candidate.action === this.interruptedCompletionAction && candidate.status !== "completed");
    const completedOperation = pendingOperation
      ? next.lifecycleOperations.find((candidate) => candidate.id === pendingOperation.id && candidate.status === "completed")
      : undefined;
    if (this.interruptedCompletionAction && completedOperation) {
      const action = this.interruptedCompletionAction;
      this.interruptedCompletionAction = undefined;
      throw new Error(`simulated worker interruption after ${action} LoopSpec materialization`);
    }
    this.registry = next;
    if (result.audit) this.audits.push(result.audit);
    return result.value;
  }
}

class InterruptOnceMappingStore implements ConnectorFieldMappingStore {
  readonly persistence = "file" as const;
  private interrupted = false;

  constructor(
    private readonly delegate: ConnectorFieldMappingStore,
    private readonly interruptAfter: "attach" | "detach"
  ) {}

  list() {
    return this.delegate.list();
  }

  saveConfirmed(input: Parameters<ConnectorFieldMappingStore["saveConfirmed"]>[0]) {
    return this.delegate.saveConfirmed(input);
  }

  async attachInstallation(mappingIds: string[], installationId: string) {
    const result = await this.delegate.attachInstallation(mappingIds, installationId);
    if (!this.interrupted && this.interruptAfter === "attach") {
      this.interrupted = true;
      throw new Error("simulated worker interruption after mapping attachment");
    }
    return result;
  }

  async detachInstallation(installationId: string, now?: Date) {
    const result = await this.delegate.detachInstallation(installationId, now);
    if (!this.interrupted && this.interruptAfter === "detach") {
      this.interrupted = true;
      throw new Error("simulated worker interruption after mapping detachment");
    }
    return result;
  }
}

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
  it("resumes an interrupted install without duplicating shared ownership", async () => {
    const input = await harness();
    const mappingStore = new InterruptOnceMappingStore(input.mappingStore, "attach");
    const service = new AppInstallationService(input.marketplace, input.projectRoot, "acme", "acme-company", {
      contextStore: input.contextStore,
      mappingStore
    });
    const plan = await service.plan({
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
      now: new Date("2026-08-08T10:00:00.000Z")
    });

    await expect(service.apply(plan, "Bearer eyJabcdefgh.abcdefgh.abcdefgh", new Date("2026-08-08T10:00:30.000Z")))
      .rejects.toThrow(/Secret-like material was blocked/);
    expect((await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read()).lifecycleOperations)
      .toHaveLength(0);
    await expect(service.apply(plan, "admin-1", new Date("2026-08-08T10:01:00.000Z")))
      .rejects.toThrow(/simulated worker interruption/);
    const afterInterruption = await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(afterInterruption.installations).toHaveLength(0);
    expect(afterInterruption.lifecycleOperations).toEqual([
      expect.objectContaining({ action: "install", status: "requires_reconciliation", failureCode: "operation_interrupted" })
    ]);
    const journey = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot: input.projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads"
    }) as {
      stage: string;
      recovery: { action: string; status: string; affected: { loops: number; fieldMappings: number } };
      nextAction: { kind: string; requiresHumanConfirmation: boolean; input: Record<string, unknown> };
    };
    expect(journey).toMatchObject({
      stage: "recover_lifecycle",
      recovery: {
        action: "install",
        status: "requires_reconciliation",
        affected: { loops: afterInterruption.lifecycleOperations[0].desired.loopIds.length, fieldMappings: input.mappingIds.length }
      },
      nextAction: { kind: "retry_exact_request", requiresHumanConfirmation: true }
    });
    expect(journey.nextAction.input).toMatchObject({ installationId: expect.any(String), targetArtifactDigest: plan.artifactDigest });

    const applied = await service.apply(plan, "admin-1", new Date("2026-08-08T11:00:00.000Z"));
    expect(applied.created).toBe(true);
    const recovered = await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(recovered.lifecycleOperations).toEqual([
      expect.objectContaining({ action: "install", status: "completed", completedAt: "2026-08-08T11:00:00.000Z" })
    ]);
    expect((await input.mappingStore.list()).every((mapping) =>
      mapping.dependentInstallationIds.filter((id) => id === applied.installation.id).length === 1
    )).toBe(true);
  });

  it("resumes an interrupted uninstall and replays its durable result", async () => {
    const input = await harness();
    const mappingStore = new InterruptOnceMappingStore(input.mappingStore, "detach");
    const service = new AppInstallationService(input.marketplace, input.projectRoot, "acme", "acme-company", {
      contextStore: input.contextStore,
      mappingStore
    });
    const plan = await service.plan({
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
      now: new Date("2026-08-08T10:10:00.000Z")
    });
    const applied = await service.apply(plan, "admin-1", new Date("2026-08-08T10:11:00.000Z"));
    const uninstall = {
      installationId: applied.installation.id,
      expectedArtifactDigest: applied.installation.artifactDigest,
      actor: "admin-1",
      reason: "Verify durable uninstall recovery.",
      confirmed: true
    };

    await expect(service.uninstall({ ...uninstall, now: new Date("2026-08-08T10:12:00.000Z") }))
      .rejects.toThrow(/simulated worker interruption/);
    const interrupted = await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(interrupted.installations).toHaveLength(1);
    expect(interrupted.lifecycleOperations.find((operation) => operation.action === "uninstall"))
      .toMatchObject({
        status: "requires_reconciliation",
        actor: "admin-1",
        uninstall: {
          fromUpdatedAt: applied.installation.updatedAt,
          reasonDigest: canonicalAppDigest({ reason: uninstall.reason }),
          sourceInstallationDigest: canonicalAppDigest(applied.installation),
          remainingLoopIds: []
        }
      });
    await expect(service.test(applied.installation.id, "admin-1", new Date("2026-08-08T10:12:30.000Z")))
      .rejects.toThrow(/must be reconciled before another operation/i);
    await expect(service.uninstall({ ...uninstall, actor: "admin-2", now: new Date("2026-08-08T10:12:40.000Z") }))
      .rejects.toThrow(/idempotency conflict/i);
    await expect(service.uninstall({ ...uninstall, reason: "A different removal reason.", now: new Date("2026-08-08T10:12:50.000Z") }))
      .rejects.toThrow(/must be reconciled/i);

    const journey = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot: input.projectRoot,
      appId: applied.installation.appId,
      installationId: applied.installation.id
    }) as { stage: string; nextAction: { input: Record<string, unknown> } };
    expect(journey).toMatchObject({
      stage: "recover_lifecycle",
      nextAction: {
        input: {
          action: "uninstall",
          reasonDigest: canonicalAppDigest({ reason: uninstall.reason }),
          fromUpdatedAt: applied.installation.updatedAt,
          remainingLoopIds: []
        }
      }
    });

    const recovered = await service.uninstall({ ...uninstall, now: new Date("2026-08-08T10:13:00.000Z") });
    await expect(service.uninstall({ ...uninstall, actor: "admin-2", now: new Date("2026-08-08T10:13:30.000Z") }))
      .rejects.toThrow(/different actor or removal reason/i);
    await expect(service.uninstall({ ...uninstall, reason: "Changed after completion.", now: new Date("2026-08-08T10:13:40.000Z") }))
      .rejects.toThrow(/different actor or removal reason/i);
    const replayed = await service.uninstall({ ...uninstall, now: new Date("2026-08-08T10:14:00.000Z") });
    expect(replayed.receipt.id).toBe(recovered.receipt.id);
    const registry = await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(registry.installations).toHaveLength(0);
    expect(registry.lifecycleOperations.find((operation) => operation.action === "uninstall"))
      .toMatchObject({ status: "completed", resultReceiptId: recovered.receipt.id });

    const reinstallPlan = await service.plan({
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
      now: new Date("2026-08-08T10:15:00.000Z")
    });
    const reinstalled = await service.apply(reinstallPlan, "admin-1", new Date("2026-08-08T10:16:00.000Z"));
    const secondUninstall = await service.uninstall({
      ...uninstall,
      expectedArtifactDigest: reinstalled.installation.artifactDigest,
      now: new Date("2026-08-08T10:17:00.000Z")
    });
    expect(secondUninstall.receipt.id).not.toBe(recovered.receipt.id);
    const finalRegistry = await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read();
    expect(finalRegistry.lifecycleOperations.filter((candidate) => candidate.action === "uninstall" && candidate.status === "completed"))
      .toHaveLength(2);
  });

  it("fails closed when owned LoopSpec topology drifts during uninstall recovery", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input, new Date("2026-08-08T10:20:00.000Z"));
    const uninstall = {
      installationId: applied.installation.id,
      expectedArtifactDigest: applied.installation.artifactDigest,
      actor: "admin-1",
      reason: "Remove the exact installed Sales App.",
      confirmed: true
    };
    store.interruptNextLifecycleRegistryCommit("uninstall");
    await expect(input.service.uninstall({ ...uninstall, now: new Date("2026-08-08T10:22:00.000Z") }))
      .rejects.toThrow(/simulated worker interruption/);

    const workspacePath = path.join(input.projectRoot, ".loopgraph", "workspace.json");
    const workspace = JSON.parse(await readFile(workspacePath, "utf8")) as {
      registeredSpecs: Array<Record<string, unknown>>;
    };
    workspace.registeredSpecs.push({
      id: "unexpected-recovery-loop",
      name: "Unexpected recovery loop",
      path: path.join(".loopgraph", "apps", "installations", applied.installation.id, "generated", "loops", "unexpected-recovery-loop.yaml"),
      department: "sales",
      addedAt: "2026-08-08T10:22:30.000Z"
    });
    await writeFile(workspacePath, JSON.stringify(workspace, null, 2), "utf8");

    await expect(input.service.uninstall({ ...uninstall, now: new Date("2026-08-08T10:23:00.000Z") }))
      .rejects.toThrow(/Active LoopSpec inventory is missing unexpected-recovery-loop/);
    expect((await store.read()).lifecycleOperations.find((operation) => operation.action === "uninstall"))
      .toMatchObject({ status: "requires_reconciliation" });
  });

  it("binds only current approved company context and records installation ownership", async () => {
    const input = await harness();
    const observedAt = "2026-08-08T11:00:00.000Z";
    const proposal = (industries: string[]) => ({
      key: "sales.icp",
      type: "object" as const,
      value: { industries, minimumEmployees: 50 },
      provenance: { source: "hermes_inference" as const, sourceRef: "discovery.session-1", observedAt },
      confidence: 0.9,
      owner: "revenue-operations",
      visibility: "workspace" as const,
      explanation: "Derived from reviewed discovery evidence."
    });
    await input.contextStore.approveValue({
      workspaceId: "acme",
      companyId: "acme-company",
      proposal: proposal(["software"]),
      approvedBy: "admin-1",
      expectedRevision: 0,
      now: new Date("2026-08-08T11:01:00.000Z")
    });
    const installValuesWithoutIcp = Object.fromEntries(Object.entries(installValues).filter(([key]) => key !== "icpDefinition"));
    const stalePlan = await input.service.plan({
      projectRoot: input.projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      connections: [input.connection],
      installValues: installValuesWithoutIcp,
      fieldMappingIds: input.mappingIds,
      actor: "admin-1",
      now: new Date("2026-08-08T11:02:00.000Z")
    });
    expect(stalePlan.configuration.provenance.icpDefinition).toMatchObject({ layer: "company_context", sourceRef: "sales.icp" });
    await input.contextStore.approveValue({
      workspaceId: "acme",
      companyId: "acme-company",
      proposal: proposal(["software", "fintech"]),
      approvedBy: "admin-1",
      expectedRevision: 1,
      now: new Date("2026-08-08T11:03:00.000Z")
    });
    await expect(input.service.apply(stalePlan, "admin-1", new Date("2026-08-08T11:04:00.000Z")))
      .rejects.toThrow(/company context changed/i);

    const freshPlan = await input.service.plan({
      projectRoot: input.projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      connections: [input.connection],
      installValues: installValuesWithoutIcp,
      fieldMappingIds: input.mappingIds,
      actor: "admin-1",
      now: new Date("2026-08-08T11:05:00.000Z")
    });
    const applied = await input.service.apply(freshPlan, "admin-1", new Date("2026-08-08T11:06:00.000Z"));
    const context = await input.contextStore.get("acme", "acme-company");
    expect(context.values.find((value) => value.key === "sales.icp")?.consumerInstallationIds).toEqual([applied.installation.id]);
  });

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
    expect(plan.assets.map((asset) => asset.kind)).toEqual(expect.arrayContaining([
      "loop_spec", "hermes_skill", "routing_card", "event_contract", "connection_binding",
      "field_mapping", "metric", "fixture", "evaluation", "graph_node", "graph_edge", "dashboard"
    ]));
    expect(plan.assets).toContainEqual(expect.objectContaining({
      id: "loop.sales-inbound-lead-intake",
      sourcePath: "loops/lead-intake.yaml"
    }));
    expect(plan.assets).toContainEqual(expect.objectContaining({
      id: "skill.sales-account-research",
      sourcePath: "skills/account-research.yaml"
    }));
    expect(plan.assets.filter((asset) => ["connection_binding", "field_mapping"].includes(asset.kind)).every((asset) => asset.action === "reuse")).toBe(true);

    const applied = await service.apply(plan, "admin-1", new Date("2026-08-08T12:05:00.000Z"));
    expect(applied.created).toBe(true);
    expect(applied.installation.state).toBe("ready_to_test");
    expect(applied.installation.operationBindings).toMatchObject({
      "crm.lead.read": {
        providerId: "hubspot",
        providerOperation: "hubspot.contacts.read",
        operation: "crm.contacts.read",
        executor: "connector_broker",
        connectionId: "hubspot-production",
        brokerCapability: "provider.data.read"
      },
      "crm.account.read": {
        providerId: "hubspot",
        operation: "crm.companies.read",
        connectionId: "hubspot-production"
      }
    });
    expect(applied.loopIds).toHaveLength(6);
    expect(applied.lock.installations[0]).toMatchObject({ appId: plan.appId, version: "1.0.0", artifactDigest: plan.artifactDigest });
    const preActivationResolution = await service.resolveOperation({
      installationId: applied.installation.id,
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      now: new Date("2026-08-08T12:05:30.000Z")
    });
    expect(preActivationResolution).toMatchObject({
      disposition: "blocked",
      blockers: [expect.stringContaining("ready_to_test")]
    });

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
    const operationResolution = await service.resolveOperation({
      installationId: applied.installation.id,
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      now: new Date("2026-08-08T12:08:30.000Z")
    });
    expect(operationResolution).toMatchObject({
      installationId: applied.installation.id,
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read",
      disposition: "invoke_read",
      blockers: [],
      binding: {
        providerId: "hubspot",
        operation: "crm.contacts.read",
        connectionId: "hubspot-production"
      }
    });
    expect(operationResolution.resolutionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const crossLoopResolution = await service.resolveOperation({
      installationId: applied.installation.id,
      loopId: "sales-inbound-account-research",
      capability: "crm.lead.read",
      now: new Date("2026-08-08T12:08:31.000Z")
    });
    expect(crossLoopResolution).toMatchObject({
      disposition: "blocked",
      blockers: [expect.stringContaining("does not declare capability crm.lead.read")]
    });
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
    expect(registry.assets).toContainEqual(expect.objectContaining({ kind: "metric", ownerInstallationIds: [applied.installation.id] }));
    expect(registry.assets).toContainEqual(expect.objectContaining({ kind: "connection_binding", ownerInstallationIds: [applied.installation.id] }));
    expect(registry.assets).toContainEqual(expect.objectContaining({ kind: "field_mapping", ownerInstallationIds: [applied.installation.id] }));
    const browserStyleStatus = await callLoopgraphAppTool("loopgraph_app_install_status", {
      projectRoot,
      installationId: applied.installation.id
    }) as { installations: Array<{ workspaceId: string }>; lifecycleOperations: Array<{ action: string; status: string }> };
    expect(browserStyleStatus.installations[0].workspaceId).toBe("acme");
    expect(browserStyleStatus.lifecycleOperations).toContainEqual(expect.objectContaining({ action: "install", status: "completed" }));
    const hermesOperationResolution = await callLoopgraphAppTool("loopgraph_app_operation_resolve", {
      projectRoot,
      installationId: applied.installation.id,
      loopId: "sales-inbound-lead-intake",
      capability: "crm.lead.read"
    }) as { disposition: string; binding: { providerId: string; operation: string } };
    expect(hermesOperationResolution).toMatchObject({
      disposition: "invoke_read",
      binding: { providerId: "hubspot", operation: "crm.contacts.read" }
    });
  });

  it("emits bounded activation approval and consumption audit contexts", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input);
    const evaluation = await input.service.test(
      applied.installation.id,
      "evaluation-runner",
      new Date("2026-08-08T12:02:00.000Z")
    );
    const approvalReason = "Approve the exact tested artifact for shadow observation.";
    const approval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "security-approver",
      reason: approvalReason,
      evidenceRefs: [evaluation.id],
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    await input.service.activate(
      applied.installation.id,
      "shadow",
      approval.id,
      "operations-activator",
      new Date("2026-08-08T12:04:00.000Z")
    );

    expect(store.audits).toHaveLength(2);
    expect(store.audits[0]).toMatchObject({
      actor: "security-approver",
      action: "app.activation.approved",
      targetType: "app_activation_approval",
      targetId: approval.id,
      metadata: {
        artifactDigest: applied.installation.artifactDigest,
        approvalDigest: approval.approvalDigest,
        fromState: "simulation_passed",
        requestedMode: "shadow",
        evidenceRefCount: 1,
        expiresAt: "2026-08-08T12:18:00.000Z"
      }
    });
    expect(store.audits[1]).toMatchObject({
      actor: "operations-activator",
      action: "app.activation.consumed",
      targetType: "app_activation_approval",
      targetId: approval.id,
      metadata: {
        approvalDigest: approval.approvalDigest,
        fromState: "simulation_passed",
        requestedMode: "shadow",
        evidenceRefCount: 1
      }
    });
    for (const audit of store.audits) {
      expect(audit.metadata.appIdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      if (audit.action === "app.activation.approved" || audit.action === "app.activation.consumed") {
        expect(audit.metadata.installationIdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    }
    const serialized = JSON.stringify(store.audits);
    expect(serialized).not.toContain(approvalReason);
    expect(serialized).not.toContain(evaluation.id);
    expect(serialized).not.toContain(applied.installation.id);
    expect(serialized).not.toContain(applied.installation.appId);
  }, 20_000);

  it("resumes an interrupted activation without replaying authority or losing LoopSpec state", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input);
    const evaluation = await input.service.test(
      applied.installation.id,
      "evaluation-runner",
      new Date("2026-08-08T12:02:00.000Z")
    );
    const shadowApproval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "security-approver",
      reason: "Observe the exact tested artifact in shadow mode.",
      evidenceRefs: [evaluation.id],
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    await input.service.activate(
      applied.installation.id,
      "shadow",
      shadowApproval.id,
      "operations-activator",
      new Date("2026-08-08T12:04:00.000Z")
    );
    const recommendApproval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "recommend",
      approvedBy: "security-approver",
      reason: "Shadow evidence supports governed recommendations.",
      evidenceRefs: [evaluation.id],
      expiresInSeconds: 60,
      now: new Date("2026-08-08T12:05:00.000Z")
    });

    store.interruptNextActivationRegistryCommit();
    await expect(input.service.activate(
      applied.installation.id,
      "recommend",
      recommendApproval.id,
      "operations-activator",
      new Date("2026-08-08T12:05:30.000Z")
    )).rejects.toThrow("simulated worker interruption");

    const interrupted = await store.read();
    expect(interrupted.installations[0]).toMatchObject({ state: "shadow", mode: "shadow" });
    expect(interrupted.activationApprovals.find((approval) => approval.id === recommendApproval.id)?.consumedAt).toBeUndefined();
    expect(interrupted.lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "activate",
      status: "requires_reconciliation",
      failureCode: "operation_interrupted",
      activation: {
        approvalReceiptId: recommendApproval.id,
        approvalDigest: recommendApproval.approvalDigest,
        fromState: "shadow",
        targetMode: "recommend"
      }
    }));
    const materializedModes = (await new FileLoopSpecRegistryStore(input.projectRoot).listActiveLoopSpecs(input.projectRoot))
      .filter((artifact) => artifact.spec.metadata.labels?.installationId === applied.installation.id)
      .map((artifact) => artifact.spec.routing?.activationMode);
    expect(new Set(materializedModes)).toEqual(new Set(["recommend"]));
    await expect(input.service.pause(applied.installation.id, "operations-activator"))
      .rejects.toThrow(/must be reconciled/i);
    await expect(input.service.activate(
      applied.installation.id,
      "recommend",
      recommendApproval.id,
      "different-activator",
      new Date("2026-08-08T12:06:30.000Z")
    )).rejects.toThrow(/idempotency conflict/i);
    expect((await store.read()).lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "activate",
      actor: "operations-activator",
      status: "requires_reconciliation"
    }));
    const journey = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot: input.projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: applied.installation.appId,
      installationId: applied.installation.id
    }, { appInstallationStoreFactory: () => store }) as {
      stage: string;
      recovery: { action: string; status: string };
      nextAction: { kind: string; input: Record<string, unknown> };
    };
    expect(journey).toMatchObject({
      stage: "recover_lifecycle",
      recovery: { action: "activate", status: "requires_reconciliation" },
      nextAction: {
        kind: "retry_exact_request",
        input: {
          action: "activate",
          installationId: applied.installation.id,
          approvalReceiptId: recommendApproval.id,
          mode: "recommend"
        }
      }
    });

    const recovered = await input.service.activate(
      applied.installation.id,
      "recommend",
      recommendApproval.id,
      "operations-activator",
      new Date("2026-08-08T12:07:00.000Z")
    );
    expect(recovered).toMatchObject({ state: "recommend", mode: "recommend" });
    const completed = await store.read();
    expect(completed.lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "activate",
      status: "completed",
      completedAt: "2026-08-08T12:07:00.000Z"
    }));
    expect(completed.activationApprovals.find((approval) => approval.id === recommendApproval.id)).toMatchObject({
      consumedAt: "2026-08-08T12:07:00.000Z",
      consumedBy: "operations-activator"
    });
    expect(store.audits.filter((audit) =>
      audit.action === "app.activation.consumed" && audit.targetId === recommendApproval.id)).toHaveLength(1);

    const completedRevision = completed.revision;
    const replayed = await input.service.activate(
      applied.installation.id,
      "recommend",
      recommendApproval.id,
      "operations-activator",
      new Date("2026-08-08T12:08:00.000Z")
    );
    expect(replayed).toMatchObject({ state: "recommend", mode: "recommend" });
    expect((await store.read()).revision).toBe(completedRevision);
  }, 20_000);

  it("keeps installed LoopSpec routing synchronized with App rollout, pause, and resume", async () => {
    const input = await harness();
    const applied = await installSalesApp(input);
    const evaluation = await input.service.test(
      applied.installation.id,
      "admin-1",
      new Date("2026-08-08T12:02:00.000Z")
    );
    const activate = async (
      mode: "shadow" | "recommend" | "execute_with_approval",
      approvedAt: string,
      activatedAt: string
    ) => {
      const approval = await input.service.approveActivation({
        installationId: applied.installation.id,
        mode,
        approvedBy: "admin-1",
        reason: `Promote the exact tested App to ${mode}.`,
        evidenceRefs: [evaluation.id],
        now: new Date(approvedAt)
      });
      return input.service.activate(
        applied.installation.id,
        mode,
        approval.id,
        "admin-1",
        new Date(activatedAt)
      );
    };
    const routingModes = async () => {
      const specs = await new FileLoopSpecRegistryStore(input.projectRoot).listActiveLoopSpecs(input.projectRoot);
      return specs
        .filter((artifact) => artifact.spec.metadata.labels?.installationId === applied.installation.id)
        .map((artifact) => artifact.spec.routing?.activationMode);
    };

    await activate("shadow", "2026-08-08T12:03:00.000Z", "2026-08-08T12:04:00.000Z");
    expect(new Set(await routingModes())).toEqual(new Set(["shadow"]));
    await activate("recommend", "2026-08-08T12:05:00.000Z", "2026-08-08T12:06:00.000Z");
    expect(new Set(await routingModes())).toEqual(new Set(["recommend"]));
    await activate("execute_with_approval", "2026-08-08T12:07:00.000Z", "2026-08-08T12:08:00.000Z");
    expect(new Set(await routingModes())).toEqual(new Set(["execute_with_approval"]));

    const paused = await input.service.pause(applied.installation.id, "admin-1");
    expect(paused).toMatchObject({ state: "paused", mode: "execute_with_approval" });
    expect(new Set(await routingModes())).toEqual(new Set(["shadow"]));
    const resumed = await input.service.resume(applied.installation.id, "admin-1");
    expect(resumed).toMatchObject({ state: "execute_with_approval", mode: "execute_with_approval" });
    expect(new Set(await routingModes())).toEqual(new Set(["execute_with_approval"]));
  });

  it("recovers interrupted pause and resume without leaving App and LoopSpec state split", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input);
    const evaluation = await input.service.test(applied.installation.id, "admin-1", new Date("2026-08-08T12:02:00.000Z"));
    const shadowApproval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "admin-1",
      reason: "Observe the tested App in shadow mode.",
      evidenceRefs: [evaluation.id],
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    await input.service.activate(applied.installation.id, "shadow", shadowApproval.id, "admin-1", new Date("2026-08-08T12:04:00.000Z"));
    const recommendApproval = await input.service.approveActivation({
      installationId: applied.installation.id,
      mode: "recommend",
      approvedBy: "admin-1",
      reason: "Shadow evidence supports recommendations.",
      evidenceRefs: [evaluation.id],
      now: new Date("2026-08-08T12:05:00.000Z")
    });
    await input.service.activate(applied.installation.id, "recommend", recommendApproval.id, "admin-1", new Date("2026-08-08T12:06:00.000Z"));
    const routingModes = async () => (await new FileLoopSpecRegistryStore(input.projectRoot).listActiveLoopSpecs(input.projectRoot))
      .filter((artifact) => artifact.spec.metadata.labels?.installationId === applied.installation.id)
      .map((artifact) => artifact.spec.routing?.activationMode);

    store.interruptNextLifecycleRegistryCommit("pause");
    await expect(input.service.pause(applied.installation.id, "admin-1", new Date("2026-08-08T12:07:00.000Z")))
      .rejects.toThrow("simulated worker interruption after pause");
    let registry = await store.read();
    expect(registry.installations[0]).toMatchObject({ state: "recommend", mode: "recommend" });
    expect(new Set(await routingModes())).toEqual(new Set(["shadow"]));
    expect(registry.lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "pause",
      actor: "admin-1",
      status: "requires_reconciliation",
      rollout: {
        fromState: "recommend",
        fromMode: "recommend",
        fromUpdatedAt: "2026-08-08T12:06:00.000Z",
        targetState: "paused",
        targetMode: "recommend"
      }
    }));
    await expect(input.service.pause(applied.installation.id, "different-admin", new Date("2026-08-08T12:07:30.000Z")))
      .rejects.toThrow(/idempotency conflict/i);
    const pauseJourney = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot: input.projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: applied.installation.appId,
      installationId: applied.installation.id
    }, { appInstallationStoreFactory: () => store }) as {
      stage: string;
      recovery: { action: string; status: string };
      nextAction: { kind: string; input: Record<string, unknown> };
    };
    expect(pauseJourney).toMatchObject({
      stage: "recover_lifecycle",
      recovery: { action: "pause", status: "requires_reconciliation" },
      nextAction: {
        kind: "retry_exact_request",
        input: { action: "pause", installationId: applied.installation.id, targetState: "paused", mode: "recommend" }
      }
    });

    const paused = await input.service.pause(applied.installation.id, "admin-1", new Date("2026-08-08T12:08:00.000Z"));
    expect(paused).toMatchObject({ state: "paused", mode: "recommend" });
    registry = await store.read();
    const pausedRevision = registry.revision;
    expect(registry.lifecycleOperations).toContainEqual(expect.objectContaining({ action: "pause", status: "completed" }));
    expect(await input.service.pause(applied.installation.id, "admin-1", new Date("2026-08-08T12:08:30.000Z")))
      .toMatchObject({ state: "paused", mode: "recommend" });
    expect((await store.read()).revision).toBe(pausedRevision);

    store.interruptNextLifecycleRegistryCommit("resume");
    await expect(input.service.resume(applied.installation.id, "admin-1", new Date("2026-08-08T12:09:00.000Z")))
      .rejects.toThrow("simulated worker interruption after resume");
    registry = await store.read();
    expect(registry.installations[0]).toMatchObject({ state: "paused", mode: "recommend" });
    expect(new Set(await routingModes())).toEqual(new Set(["recommend"]));
    expect(registry.lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "resume",
      actor: "admin-1",
      status: "requires_reconciliation",
      rollout: {
        fromState: "paused",
        fromMode: "recommend",
        fromUpdatedAt: "2026-08-08T12:08:00.000Z",
        targetState: "recommend",
        targetMode: "recommend"
      }
    }));

    const resumed = await input.service.resume(applied.installation.id, "admin-1", new Date("2026-08-08T12:10:00.000Z"));
    expect(resumed).toMatchObject({ state: "recommend", mode: "recommend" });
    const resumedRevision = (await store.read()).revision;
    expect(await input.service.resume(applied.installation.id, "admin-1", new Date("2026-08-08T12:10:30.000Z")))
      .toMatchObject({ state: "recommend", mode: "recommend" });
    expect((await store.read()).revision).toBe(resumedRevision);

    const pausedAgain = await input.service.pause(applied.installation.id, "admin-1", new Date("2026-08-08T12:11:00.000Z"));
    expect(pausedAgain).toMatchObject({ state: "paused", mode: "recommend" });
    expect((await store.read()).revision).toBeGreaterThan(resumedRevision);
    const resumedAgain = await input.service.resume(applied.installation.id, "admin-1", new Date("2026-08-08T12:12:00.000Z"));
    expect(resumedAgain).toMatchObject({ state: "recommend", mode: "recommend" });
    expect((await store.read()).lifecycleOperations.filter((operation) => operation.action === "pause" && operation.status === "completed")).toHaveLength(2);
    expect((await store.read()).lifecycleOperations.filter((operation) => operation.action === "resume" && operation.status === "completed")).toHaveLength(2);
  }, 20_000);

  it("rejects missing, mismatched, and expired approvals while replaying only an exact completed activation", async () => {
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
    const activated = await input.service.activate(
      applied.installation.id,
      "shadow",
      freshApproval.id,
      "admin-1",
      new Date("2026-08-08T12:06:00.000Z")
    );
    const completedRevision = (await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read()).revision;
    const replayed = await input.service.activate(
      applied.installation.id,
      "shadow",
      freshApproval.id,
      "admin-1",
      new Date("2026-08-08T12:06:30.000Z")
    );
    expect(replayed).toEqual(activated);
    expect((await new FileAppInstallationStore(path.join(input.projectRoot, ".loopgraph", "apps"), "acme").read()).revision).toBe(completedRevision);
  });

  it("plans, materializes, and tests only the modules selected by the operator", async () => {
    const input = await harness();
    const plan = await input.service.plan({
      projectRoot: input.projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      selectedModules: ["account-research"],
      connections: [input.connection],
      installValues,
      fieldMappingIds: input.mappingIds,
      actor: "admin-1",
      now: new Date("2026-08-08T12:00:00.000Z")
    });

    expect(installPlanBlockers(plan)).toEqual([]);
    expect(plan.selectedModules).toEqual(["account-research"]);
    expect(plan.assets).not.toContainEqual(expect.objectContaining({ id: "loop.sales-inbound-follow-up" }));
    expect(plan.assets).not.toContainEqual(expect.objectContaining({ id: "skill.sales-personalized-follow-up" }));
    expect(plan.permissions.map((permission) => permission.capability)).not.toContain("mail.message.send");
    expect(plan.graphDiff.edgesAdded.some((edgeId) => edgeId.includes("routing-returns-to-follow-up"))).toBe(false);

    const applied = await input.service.apply(plan, "admin-1", new Date("2026-08-08T12:01:00.000Z"));
    expect(applied.loopIds).toHaveLength(5);
    expect(applied.loopIds).not.toContain("sales-inbound-follow-up");
    const evaluation = await input.service.test(applied.installation.id, "admin-1", new Date("2026-08-08T12:02:00.000Z"));
    expect(evaluation.status).toBe("passed");
    expect(evaluation.scenarios.find((scenario) => scenario.id === "customer-facing-action")).toMatchObject({
      expectedAction: "unhandled",
      actualAction: "unhandled",
      status: "passed"
    });
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
    expect(plan.conflicts).toContainEqual(expect.objectContaining({
      kind: "duplicate_loop",
      resourceId: "loop.sales-inbound-lead-intake",
      blocking: true
    }));
    expect(plan.assets).toContainEqual(expect.objectContaining({
      id: "loop.sales-inbound-lead-intake",
      action: "update"
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
    const tamperedComposition = {
      ...plan,
      selectedModules: ["account-research"],
      planDigest: canonicalAppDigest({ ...plan, selectedModules: ["account-research"], planDigest: undefined })
    };
    await expect(service.apply(tamperedComposition, "admin-1", new Date("2026-08-08T12:05:00.000Z"))).rejects.toThrow(/selected module composition/i);
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
      operations: [
        { op: "set", path: "/values/qualificationThreshold", value: { qualified: 90, reviewMin: 70 } },
        { op: "disable_module", moduleId: "governed-follow-up" }
      ],
      expectedArtifactDigest: applied.installation.artifactDigest,
      expectedOverlayRevision: 0,
      actor: "sales-admin",
      now: new Date("2026-08-08T12:03:00.000Z")
    });
    expect(overlaid.installation?.overlay?.revision).toBe(1);
    expect(overlaid.installation?.selectedModules).toEqual(["account-research"]);
    expect(overlaid.installation?.ownedAssets).not.toContainEqual(expect.objectContaining({ assetId: "loop.sales-inbound-follow-up" }));
    expect(overlaid.installation?.permissions.map((permission) => permission.capability)).not.toContain("mail.message.send");
    expect((await readLoopgraphWorkspace(input.projectRoot)).registeredSpecs.map((entry) => entry.id)).not.toContain("sales-inbound-follow-up");
    expect(overlaid.receipt.action).toBe("overlay");
    await expect(input.service.applyOverlay({
      installationId: applied.installation.id,
      operations: [{ op: "enable_module", moduleId: "governed-follow-up" }],
      expectedArtifactDigest: applied.installation.artifactDigest,
      expectedOverlayRevision: 1,
      actor: "sales-admin",
      now: new Date("2026-08-08T12:03:30.000Z")
    })).rejects.toThrow(/fresh install plan/i);

    const repaired = await input.service.repair(applied.installation.id, "sales-admin", new Date("2026-08-08T12:04:00.000Z"));
    expect(repaired.installation).toMatchObject({ state: "ready_to_test", mode: "simulation" });
    expect(repaired.receipt.action).toBe("repair");
    expect(repaired.installation?.ownedAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "connection_binding" }),
      expect.objectContaining({ kind: "field_mapping" })
    ]));

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
    expect(duplicated.installation?.ownedAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "connection_binding" }),
      expect.objectContaining({ kind: "field_mapping" })
    ]));
    expect((await input.mappingStore.list()).filter((mapping) => input.mappingIds.includes(mapping.id)).every((mapping) =>
      mapping.dependentInstallationIds.includes(duplicated.installation!.id)
    )).toBe(true);

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

  it("recovers and replays only the exact actor-bound configuration request", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input);
    const sourceConfigurationDigest = canonicalAppDigest(applied.installation.configuration);
    const request = {
      installationId: applied.installation.id,
      values: { followUpSlaMinutes: 45 },
      expectedConfigurationDigest: sourceConfigurationDigest,
      actor: "sales-admin"
    };

    store.interruptNextLifecycleRegistryCommit("configure");
    await expect(input.service.configure({
      ...request,
      now: new Date("2026-08-08T12:02:00.000Z")
    })).rejects.toThrow(/simulated worker interruption/i);

    const interrupted = await store.read();
    const recovery = interrupted.lifecycleOperations.find((operation) => operation.action === "configure");
    expect(recovery).toMatchObject({
      status: "requires_reconciliation",
      actor: "sales-admin",
      configure: {
        sourceConfigurationDigest,
        fromUpdatedAt: applied.installation.updatedAt
      }
    });
    expect(Object.keys(recovery?.configure ?? {}).sort()).toEqual([
      "fromUpdatedAt",
      "sourceConfigurationDigest",
      "sourceInstallationDigest",
      "targetConfigurationDigest",
      "targetInstallationDigest",
      "valuesDigest"
    ]);
    expect(JSON.stringify(recovery)).not.toContain("followUpSlaMinutes");

    await expect(input.service.configure({
      ...request,
      actor: "another-admin",
      now: new Date("2026-08-08T12:03:00.000Z")
    })).rejects.toThrow(/must be reconciled/i);
    await expect(input.service.configure({
      ...request,
      values: { followUpSlaMinutes: 60 },
      now: new Date("2026-08-08T12:03:00.000Z")
    })).rejects.toThrow(/must be reconciled/i);

    const recovered = await input.service.configure({
      ...request,
      now: new Date("2026-08-08T12:04:00.000Z")
    });
    expect(recovered.installation?.configuration.values.followUpSlaMinutes).toBe(45);
    expect(recovered.receipt).toMatchObject({ action: "configure", actor: "sales-admin" });
    const completedRevision = (await store.read()).revision;

    const replayed = await input.service.configure({
      ...request,
      now: new Date("2026-08-08T12:05:00.000Z")
    });
    expect(replayed.receipt.id).toBe(recovered.receipt.id);
    expect((await store.read()).revision).toBe(completedRevision);
    await expect(input.service.configure({
      ...request,
      actor: "another-admin",
      now: new Date("2026-08-08T12:05:00.000Z")
    })).rejects.toThrow(/configuration changed/i);

    const later = await input.service.configure({
      installationId: applied.installation.id,
      values: { followUpSlaMinutes: 60 },
      expectedConfigurationDigest: canonicalAppDigest(recovered.installation?.configuration),
      actor: "sales-admin",
      now: new Date("2026-08-08T12:06:00.000Z")
    });
    expect(later.receipt.id).not.toBe(recovered.receipt.id);
    expect((await store.read()).lifecycleOperations.filter((operation) =>
      operation.action === "configure" && operation.status === "completed"
    )).toHaveLength(2);
  });

  it("recovers owned LoopSpec rematerialization only for the exact actor-bound overlay", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input);
    const operations = [
      { op: "set" as const, path: "/values/qualificationThreshold", value: { qualified: 90, reviewMin: 70 } },
      { op: "disable_module" as const, moduleId: "governed-follow-up" }
    ];
    const request = {
      installationId: applied.installation.id,
      operations,
      expectedArtifactDigest: applied.installation.artifactDigest,
      expectedOverlayRevision: 0,
      actor: "sales-admin"
    };

    store.interruptNextLifecycleRegistryCommit("overlay");
    await expect(input.service.applyOverlay({
      ...request,
      now: new Date("2026-08-08T12:03:00.000Z")
    })).rejects.toThrow(/simulated worker interruption after overlay LoopSpec materialization/i);

    const interrupted = await store.read();
    expect(interrupted.installations[0].overlay).toBeUndefined();
    const recovery = interrupted.lifecycleOperations.find((operation) => operation.action === "overlay");
    expect(recovery).toMatchObject({
      status: "requires_reconciliation",
      actor: "sales-admin",
      overlay: {
        fromUpdatedAt: applied.installation.updatedAt,
        sourceArtifactDigest: applied.installation.artifactDigest,
        sourceInstallationDigest: canonicalAppDigest(applied.installation),
        expectedOverlayRevision: 0,
        operationsDigest: canonicalAppDigest(operations),
        sourceLoopIds: expect.any(Array),
        targetLoopIds: expect.any(Array)
      }
    });
    expect(Object.keys(recovery?.overlay ?? {}).sort()).toEqual([
      "expectedOverlayRevision",
      "fromUpdatedAt",
      "operationsDigest",
      "sourceArtifactDigest",
      "sourceInstallationDigest",
      "sourceLoopIds",
      "sourceLoopInventoryDigest",
      "sourceOwnershipDigest",
      "sourceWorkspaceRevision",
      "targetInstallationDigest",
      "targetLoopIds",
      "targetLoopInventoryDigest",
      "targetOwnershipDigest"
    ]);
    expect(JSON.stringify(recovery)).not.toContain("qualificationThreshold");
    expect((await readLoopgraphWorkspace(input.projectRoot)).registeredSpecs.map((entry) => entry.id)).not.toContain("sales-inbound-follow-up");

    await expect(input.service.applyOverlay({
      ...request,
      actor: "another-admin",
      now: new Date("2026-08-08T12:03:30.000Z")
    })).rejects.toThrow(/must be reconciled|idempotency conflict/i);
    await expect(input.service.applyOverlay({
      ...request,
      operations: [{ op: "set", path: "/values/followUpSlaMinutes", value: 45 }],
      now: new Date("2026-08-08T12:03:40.000Z")
    })).rejects.toThrow(/must be reconciled/i);

    const recovered = await input.service.applyOverlay({
      ...request,
      now: new Date("2026-08-08T12:04:00.000Z")
    });
    expect(recovered.installation?.overlay?.revision).toBe(1);
    expect(recovered.installation?.selectedModules).toEqual(["account-research"]);
    expect(recovered.receipt).toMatchObject({ action: "overlay", actor: "sales-admin" });
    const completedRevision = (await store.read()).revision;

    const replayed = await input.service.applyOverlay({
      ...request,
      now: new Date("2026-08-08T12:05:00.000Z")
    });
    expect(replayed.receipt.id).toBe(recovered.receipt.id);
    expect((await store.read()).revision).toBe(completedRevision);

    const later = await input.service.applyOverlay({
      installationId: applied.installation.id,
      operations: [{ op: "set", path: "/values/followUpSlaMinutes", value: 45 }],
      expectedArtifactDigest: applied.installation.artifactDigest,
      expectedOverlayRevision: 1,
      actor: "sales-admin",
      now: new Date("2026-08-08T12:06:00.000Z")
    });
    expect(later.receipt.id).not.toBe(recovered.receipt.id);
    expect((await store.read()).lifecycleOperations.filter((operation) =>
      operation.action === "overlay" && operation.status === "completed"
    )).toHaveLength(2);
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
    expect(updated.installation?.ownedAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "connection_binding" }),
      expect.objectContaining({ kind: "field_mapping" })
    ]));

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

  it("resumes an interrupted update only for the exact actor, reviewed plan, approvals, and LoopSpec target", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input, new Date("2026-08-08T12:10:00.000Z"));
    await addUpdateCatalog(input);
    const updatePlan = await input.service.planUpdate({
      installationId: applied.installation.id,
      versionRange: "1.1.0",
      connections: [input.connection],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:11:00.000Z")
    });

    store.interruptNextLifecycleRegistryCommit("update");
    await expect(input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:12:00.000Z")
    })).rejects.toThrow(/simulated worker interruption after update LoopSpec materialization/i);

    const interrupted = await store.read();
    expect(interrupted.installations[0]).toMatchObject({ version: "1.0.0", artifactDigest: applied.installation.artifactDigest });
    expect(interrupted.lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "update",
      status: "requires_reconciliation",
      actor: "sales-admin",
      targetArtifactDigest: updatePlan.toDigest,
      update: expect.objectContaining({
        fromUpdatedAt: applied.installation.updatedAt,
        sourceArtifactDigest: applied.installation.artifactDigest,
        sourceInstallationDigest: canonicalAppDigest(applied.installation),
        planDigest: updatePlan.planDigest,
        approvedPermissionCapabilities: ["crm.lead.update"],
        targetInstallationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        sourceLoopIds: expect.any(Array),
        targetLoopIds: expect.any(Array)
      })
    }));
    await expect(input.service.test(applied.installation.id, "sales-admin", new Date("2026-08-08T12:12:30.000Z")))
      .rejects.toThrow(/must be reconciled before another operation/i);
    await expect(input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "another-admin",
      now: new Date("2026-08-08T12:12:40.000Z")
    })).rejects.toThrow(/idempotency conflict/i);
    await expect(input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update", "crm.account.read"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:12:45.000Z")
    })).rejects.toThrow(/do not require review/i);

    const workspacePath = path.join(input.projectRoot, ".loopgraph", "workspace.json");
    const recordedTargetWorkspace = await readFile(workspacePath, "utf8");
    const driftedWorkspace = JSON.parse(recordedTargetWorkspace) as { registeredSpecs: Array<Record<string, unknown>> };
    driftedWorkspace.registeredSpecs.push({
      id: "unexpected-update-loop",
      name: "Unexpected update loop",
      path: path.join(".loopgraph", "apps", "installations", applied.installation.id, "generated", "loops", "unexpected-update-loop.yaml"),
      department: "sales",
      addedAt: "2026-08-08T12:12:50.000Z"
    });
    await writeFile(workspacePath, JSON.stringify(driftedWorkspace, null, 2), "utf8");
    await expect(input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:12:55.000Z")
    })).rejects.toThrow(/Active LoopSpec inventory is missing unexpected-update-loop/i);
    await writeFile(workspacePath, recordedTargetWorkspace, "utf8");

    const recovered = await input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:42:00.000Z")
    });
    const replayed = await input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:43:00.000Z")
    });
    expect(replayed.receipt.id).toBe(recovered.receipt.id);
    await expect(input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "another-admin",
      now: new Date("2026-08-08T12:43:30.000Z")
    })).rejects.toThrow(/different actor, reviewed plan, or installation revision/i);
    expect(recovered.installation).toMatchObject({ version: "1.1.0", state: "ready_to_test", mode: "simulation" });
    expect((await store.read()).lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "update",
      status: "completed",
      resultReceiptId: recovered.receipt.id
    }));

    const rolledBack = await input.service.rollback(
      applied.installation.id,
      recovered.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T12:44:00.000Z")
    );
    const secondPlan = await input.service.planUpdate({
      installationId: applied.installation.id,
      versionRange: "1.1.0",
      connections: [input.connection],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:45:00.000Z")
    });
    const secondUpdate = await input.service.applyUpdate({
      plan: secondPlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T12:46:00.000Z")
    });
    expect(rolledBack.installation).toMatchObject({ version: "1.0.0" });
    expect(secondUpdate.receipt.id).not.toBe(recovered.receipt.id);
    expect((await store.read()).lifecycleOperations.filter((operation) => operation.action === "update" && operation.status === "completed"))
      .toHaveLength(2);
  });

  it("resumes an interrupted rollback only for the exact actor, installation, and LoopSpec target", async () => {
    const store = new AuditCapturingInstallationStore("acme");
    const input = await harness({ installationStore: store });
    const applied = await installSalesApp(input, new Date("2026-08-08T13:00:00.000Z"));
    await addUpdateCatalog(input);
    const updatePlan = await input.service.planUpdate({
      installationId: applied.installation.id,
      versionRange: "1.1.0",
      connections: [input.connection],
      actor: "sales-admin",
      now: new Date("2026-08-08T13:01:00.000Z")
    });
    const updated = await input.service.applyUpdate({
      plan: updatePlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T13:02:00.000Z")
    });

    store.interruptNextLifecycleRegistryCommit("rollback");
    await expect(input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T13:03:00.000Z")
    )).rejects.toThrow(/simulated worker interruption after rollback LoopSpec materialization/i);

    const interrupted = await store.read();
    expect(interrupted.installations[0]).toMatchObject({ version: "1.1.0", state: "ready_to_test" });
    expect(interrupted.lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "rollback",
      status: "requires_reconciliation",
      actor: "sales-admin",
      targetArtifactDigest: applied.installation.artifactDigest,
      rollback: expect.objectContaining({
        fromUpdatedAt: updated.installation!.updatedAt,
        sourceArtifactDigest: updated.installation!.artifactDigest,
        sourceInstallationDigest: canonicalAppDigest(updated.installation),
        targetInstallationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        sourceLoopIds: expect.any(Array),
        targetLoopIds: expect.any(Array)
      })
    }));
    await expect(input.service.test(applied.installation.id, "sales-admin", new Date("2026-08-08T13:03:30.000Z")))
      .rejects.toThrow(/must be reconciled before another operation/i);
    await expect(input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "another-admin",
      new Date("2026-08-08T13:03:40.000Z")
    )).rejects.toThrow(/idempotency conflict/i);

    const workspacePath = path.join(input.projectRoot, ".loopgraph", "workspace.json");
    const recordedTargetWorkspace = await readFile(workspacePath, "utf8");
    const driftedWorkspace = JSON.parse(recordedTargetWorkspace) as { registeredSpecs: Array<Record<string, unknown>> };
    driftedWorkspace.registeredSpecs.push({
      id: "unexpected-rollback-loop",
      name: "Unexpected rollback loop",
      path: path.join(".loopgraph", "apps", "installations", applied.installation.id, "generated", "loops", "unexpected-rollback-loop.yaml"),
      department: "sales",
      addedAt: "2026-08-08T13:03:45.000Z"
    });
    await writeFile(workspacePath, JSON.stringify(driftedWorkspace, null, 2), "utf8");
    await expect(input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T13:03:50.000Z")
    )).rejects.toThrow(/Active LoopSpec inventory is missing unexpected-rollback-loop/i);
    await writeFile(workspacePath, recordedTargetWorkspace, "utf8");

    const recovered = await input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T13:04:00.000Z")
    );
    const replayed = await input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T13:04:30.000Z")
    );
    expect(replayed.receipt.id).toBe(recovered.receipt.id);
    await expect(input.service.rollback(
      applied.installation.id,
      updated.installation!.artifactDigest,
      "another-admin",
      new Date("2026-08-08T13:04:40.000Z")
    )).rejects.toThrow(/different actor or installation revision/i);
    expect((await store.read()).lifecycleOperations).toContainEqual(expect.objectContaining({
      action: "rollback",
      status: "completed",
      resultReceiptId: recovered.receipt.id
    }));
    expect(recovered.installation).toMatchObject({ version: "1.0.0", state: "rolled_back", mode: "simulation" });

    const secondPlan = await input.service.planUpdate({
      installationId: applied.installation.id,
      versionRange: "1.1.0",
      connections: [input.connection],
      actor: "sales-admin",
      now: new Date("2026-08-08T13:05:00.000Z")
    });
    const secondUpdate = await input.service.applyUpdate({
      plan: secondPlan,
      approvedPermissionCapabilities: ["crm.lead.update"],
      actor: "sales-admin",
      now: new Date("2026-08-08T13:06:00.000Z")
    });
    const secondRollback = await input.service.rollback(
      applied.installation.id,
      secondUpdate.installation!.artifactDigest,
      "sales-admin",
      new Date("2026-08-08T13:07:00.000Z")
    );
    expect(secondRollback.receipt.id).not.toBe(recovered.receipt.id);
    expect((await store.read()).lifecycleOperations.filter((operation) => operation.action === "rollback" && operation.status === "completed"))
      .toHaveLength(2);
  });
});
