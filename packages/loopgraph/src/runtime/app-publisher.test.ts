import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionInstanceSchema } from "../core";
import { FileConnectorFieldMappingStore } from "./app-connector-service";
import { AppInstallationService } from "./app-installation-service";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { LocalAppMarketplace } from "./app-marketplace";
import { LoopgraphAppPublisher } from "./app-publisher";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-publisher-"));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

describe("Loopgraph App publisher", () => {
  it("scaffolds a complete private app that passes deterministic conformance", async () => {
    const projectRoot = await createProject();
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "apps/customer-risk",
      appId: "acme.customer-success.customer-risk",
      name: "Customer Risk",
      department: "customer_success",
      publisherId: "acme"
    });
    const report = await publisher.validateApp(initialized.packRoot);
    expect(report.ok, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.failedScenarios).toEqual([]);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "compile", status: "passed" }),
      expect.objectContaining({ id: "synthetic-conformance", status: "passed" })
    ]));
    const developer = await publisher.inspectDeveloperApp(initialized.packRoot);
    expect(developer).toMatchObject({
      status: "ready",
      writeBlocked: true,
      previewAvailable: true,
      app: { id: "acme.customer-success.customer-risk", department: "customer_success" },
      inventory: { loops: expect.any(Array), graphNodes: expect.any(Number), graphEdges: expect.any(Number), setupQuestions: expect.any(Number), evaluationSuites: 1 }
    });
    expect(developer.inventory!.loops).toHaveLength(1);
    expect(developer.inventory!.connectorRecipes.length).toBeGreaterThan(0);
    expect(developer.permissions?.length).toBeGreaterThan(0);
    expect(developer.permissions?.filter((permission) => permission.authority === "approve" || permission.authority === "execute")
      .every((permission) => permission.defaultPolicy !== "allowed")).toBe(true);

    const preview = await publisher.previewApp(initialized.packRoot, new Date("2026-08-09T00:00:00.000Z"));
    expect(preview).toMatchObject({
      appId: "acme.customer-success.customer-risk",
      mode: "synthetic",
      status: "passed",
      writeBlocked: true,
      providerWrites: 0,
      readyForSigning: true,
      publishable: false,
      summary: { total: 13, failed: 0 }
    });
    expect(preview.scenarios).toHaveLength(13);
    expect(preview.scenarios.every((scenario) => typeof scenario.approvalRequired === "boolean")).toBe(true);
    expect(preview.graph.nodes.some((node) => node.type === "hermes_brain")).toBe(true);
  });

  it("signs immutable pack content and rejects public-key spoofing with a trusted key ID", async () => {
    const projectRoot = await createProject();
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "apps/record-route",
      appId: "acme.ops.record-route",
      name: "Record Route",
      department: "ops_finance",
      publisherId: "acme"
    });
    const trusted = await publisher.generatePublisherKey({ publisherId: "acme", keyId: "acme.release.primary", now: new Date("2026-08-09T00:00:00.000Z") });
    const attacker = await publisher.generatePublisherKey({ publisherId: "acme", keyId: "acme.release.attacker", now: new Date("2026-08-09T00:01:00.000Z") });
    await publisher.signApp({ packRoot: initialized.packRoot, keyId: attacker.keyId, now: new Date("2026-08-09T00:02:00.000Z") });
    const signaturePath = path.join(initialized.packRoot, "loopgraph.pack.signature.json");
    const signature = JSON.parse(await readFile(signaturePath, "utf8")) as Record<string, unknown>;
    signature.keyId = trusted.keyId;
    await writeFile(signaturePath, `${JSON.stringify(signature, null, 2)}\n`);

    await expect(loadLoopPackDirectory(initialized.packRoot, {
      requireSignature: true,
      trustedPublisherKeys: [{ publisherId: "acme", keyId: trusted.keyId, algorithm: "ed25519", publicKey: trusted.publicKey }]
    })).rejects.toThrow(/not trusted/i);
  });

  it("publishes signed versions idempotently and exposes deprecation through the marketplace", async () => {
    const projectRoot = await createProject();
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "apps/forecast-review",
      appId: "acme.finance.forecast-review",
      name: "Forecast Review",
      department: "ops_finance",
      publisherId: "acme"
    });
    const key = await publisher.generatePublisherKey({ publisherId: "acme", keyId: "acme.release.2026" });
    const signed = await publisher.signApp({ packRoot: initialized.packRoot, keyId: key.keyId });
    const first = await publisher.publishApp({ packRoot: initialized.packRoot, catalogId: "acme.private" });
    const second = await publisher.publishApp({ packRoot: initialized.packRoot, catalogId: "acme.private" });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.release.digest).toBe(signed.digest);
    expect(first.release.validation).toMatchObject({
      artifactDigest: signed.digest,
      status: "passed",
      writeBlocked: true,
      providerWrites: 0,
      scenarioCount: 13,
      passedScenarioCount: 13
    });
    expect(first.release.validation?.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.release.validation?.evidenceDigest).toBe(first.release.validation?.evidenceDigest);
    expect(first.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.snapshotDigest).toBe(first.snapshotDigest);

    await publisher.setReleaseStatus({
      catalogId: "acme.private",
      appId: signed.appId,
      version: signed.version,
      status: "deprecated",
      message: "Use the governed forecast review v2."
    });
    const marketplace = new LocalAppMarketplace(path.join(projectRoot, ".loopgraph", "apps", "marketplace"));
    await marketplace.refreshCatalogSource(first.sourceId);
    const app = await marketplace.getApp(signed.appId);
    expect(app?.versions[0]).toMatchObject({ deprecated: true, deprecationMessage: "Use the governed forecast review v2." });
    await expect(marketplace.resolveAppVersion(signed.appId)).rejects.toThrow(/No eligible version/i);
  });

  it("refuses to publish unsigned packs and reserves official verification claims", async () => {
    const projectRoot = await createProject();
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const initialized = await publisher.initializeApp({
      destination: "apps/private-app",
      appId: "acme.product.private-app",
      name: "Private App",
      department: "product",
      publisherId: "acme"
    });
    await expect(publisher.publishApp({ packRoot: initialized.packRoot, catalogId: "acme.private" })).rejects.toThrow(/signature/i);

    const manifestPath = path.join(initialized.packRoot, "loopgraph.pack.yaml");
    const raw = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, raw.replace("verified: false", "verified: true"));
    const report = await publisher.validateApp(initialized.packRoot);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("publisher_self_verification");

    await writeFile(manifestPath, raw.replace("acme.product.private-app", "loopgraph.product.lookalike-official-app"));
    const reservedReport = await publisher.validateApp(initialized.packRoot);
    expect(reservedReport.ok).toBe(false);
    expect(reservedReport.issues.map((issue) => issue.code)).toContain("publisher_namespace_reserved");

    await writeFile(manifestPath, raw.replace("acme.product.private-app", "other.product.unscoped-private-app"));
    const unscopedReport = await publisher.validateApp(initialized.packRoot);
    expect(unscopedReport.ok).toBe(false);
    expect(unscopedReport.issues.map((issue) => issue.code)).toContain("publisher_namespace_mismatch");
  });

  it("captures installed behavior but never copies company configuration values", async () => {
    const projectRoot = await createProject();
    const marketplace = new LocalAppMarketplace(path.join(projectRoot, ".loopgraph", "apps", "marketplace"), path.resolve(process.cwd(), "packs"));
    await marketplace.refreshAllCatalogSources();
    const mappingStore = new FileConnectorFieldMappingStore(path.join(projectRoot, ".loopgraph", "apps", "field-mappings.json"), "acme");
    const mappingIds: string[] = [];
    for (const [objectType, logicalField, providerField] of [
      ["lead", "lead.id", "id"],
      ["lead", "lead.email", "email"],
      ["lead", "lead.company", "company"],
      ["lead", "lead.lifecycleStage", "lifecyclestage"],
      ["account", "account.id", "id"],
      ["account", "account.domain", "domain"],
      ["account", "account.customerStatus", "customer_status"]
    ] as const) {
      const mapping = await mappingStore.saveConfirmed({ connectionId: "hubspot-production", objectType, logicalField, providerField, direction: "read", confidence: 1, confirmedBy: "admin" });
      mappingIds.push(mapping.id);
    }
    const service = new AppInstallationService(marketplace, projectRoot, "acme", "acme", { mappingStore });
    const plan = await service.plan({
      projectRoot,
      workspaceId: "acme",
      companyId: "acme",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      versionRange: "1.0.0",
      presetId: "hubspot-gmail-slack",
      connections: [connectionInstanceSchema.parse({ schemaVersion: "connection-instance/v1alpha1", id: "hubspot-production", manifestId: "hubspot", capabilityKeys: ["crm.lead.read", "crm.account.read"], grantedScopes: ["crm.objects.contacts.read", "crm.objects.companies.read"], status: "connected", environment: "live", readPolicy: "read_only", writePolicy: "not_allowed" })],
      installValues: {
        icpDefinition: { industries: ["private-internal-vertical"], minimumEmployees: 42 },
        exclusions: ["private-exclusion"],
        territories: { privateTerritory: "private-owner" },
        qualificationThreshold: { qualified: 85, reviewMin: 65 },
        lifecycleStages: { new: "new", qualified: "qualified", accepted: "accepted", disqualified: "disqualified" },
        followUpSlaMinutes: 30,
        customerFacingPolicy: "draft_only"
      },
      fieldMappingIds: mappingIds,
      actor: "admin",
      now: new Date("2026-08-09T10:00:00.000Z")
    });
    const installed = await service.apply(plan, "admin", new Date("2026-08-09T10:01:00.000Z"));
    const publisher = new LoopgraphAppPublisher(projectRoot);
    const capture = await publisher.captureInstallation({
      installationId: installed.installation.id,
      derivedAppId: "acme.sales.private-qualification",
      name: "Private Qualification",
      publisherId: "acme",
      destination: "apps/private-qualification"
    });
    expect(capture.copiedCredentialValues).toBe(0);
    expect(capture.parameterizedConfigurationKeys).toContain("icpDefinition");
    const contents = await readTreeText(capture.packRoot);
    expect(contents).not.toContain("private-internal-vertical");
    expect(contents).not.toContain("private-exclusion");
    expect(contents).not.toContain("private-owner");
    expect((await publisher.validateApp(capture.packRoot)).ok).toBe(true);
  });
});

async function readTreeText(root: string): Promise<string> {
  const values: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) values.push(await readFile(target, "utf8"));
    }
  }
  await visit(root);
  return values.join("\n");
}
