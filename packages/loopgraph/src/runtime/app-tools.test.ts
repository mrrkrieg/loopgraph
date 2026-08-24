import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectorInstallationViewSchema, type AppOnboardingJourney } from "../core";
import {
  appInstallationRegistrySchema,
  assertAppInstallationRegistryRevision,
  emptyAppInstallationRegistry,
  type AppInstallationMutationAuditContext,
  type AppInstallationRegistry,
  type AppInstallationStore,
  type AppInstallationUpdate
} from "./app-installation-store";
import { appDetachInputSchema, appDuplicateInputSchema, appRepairInputSchema, callLoopgraphAppTool, LOOPGRAPH_APP_TOOL_NAMES } from "./app-tools";
import { callLoopgraphConnectionTool } from "./connection-tools";
import { connectionInstanceFromBrokerInstallation } from "./connector-registry";
import { createAppIndependentVerificationReceipt } from "./app-operational-maturity";
import type { HermesRouteActivationStatus } from "./hermes-route-activation";
import { callLoopgraphHermesWebhookTool, type HermesWebhookDoctorResult } from "./hermes-webhooks";

const temporaryDirectories: string[] = [];

const readyHermesRoutingOptions = {
  routeActivationStatusProvider: async (): Promise<HermesRouteActivationStatus> => ({
    projectRoot: "/test",
    recordPath: "/test/.loopgraph/hermes-route-activation.json",
    checkedAt: "2026-08-21T12:00:00.000Z",
    exists: true,
    current: true,
    ready: true,
    planDigest: "a1b2c3d4e5f60708",
    currentPlanDigest: "a1b2c3d4e5f60708",
    routeStates: [{
      routeId: "hermes_route_sales",
      routeName: "loopgraph-sales-events",
      routeKind: "provider_event" as const,
      loopIds: [
        "sales-inbound-account-research",
        "sales-inbound-follow-up",
        "sales-inbound-lead-intake",
        "sales-inbound-lead-qualification",
        "sales-inbound-lead-routing",
        "sales-inbound-qualification-learning"
      ],
      state: "shadow" as const,
      subscriptionState: "active" as const,
      signatureVerificationConfigured: true,
      ready: true
    }],
    warnings: [],
    nextActions: ["Hermes routes are ready."]
  }),
  webhookDoctorProvider: async (): Promise<HermesWebhookDoctorResult> => ({
    ok: true,
    plan: {
      catalogVersion: "routing-catalog-test",
      routes: [{
        routeKind: "provider_event",
        loopIds: [
          "sales-inbound-account-research",
          "sales-inbound-follow-up",
          "sales-inbound-lead-intake",
          "sales-inbound-lead-qualification",
          "sales-inbound-lead-routing",
          "sales-inbound-qualification-learning"
        ]
      }]
    }
  } as HermesWebhookDoctorResult)
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("shared Loopgraph App tools", () => {
  it("exposes the required marketplace and lifecycle surface", () => {
    expect(LOOPGRAPH_APP_TOOL_NAMES).toEqual([
      "loopgraph_company_blueprints_search",
      "loopgraph_company_blueprint_get",
      "loopgraph_company_context_get",
      "loopgraph_company_context_approve",
      "loopgraph_department_packs_search",
      "loopgraph_department_pack_get",
      "loopgraph_marketplace_search",
      "loopgraph_app_get",
      "loopgraph_app_onboarding_get",
      "loopgraph_app_onboarding_save",
      "loopgraph_app_onboarding_reset",
      "loopgraph_app_install_plan",
      "loopgraph_app_install_apply",
      "loopgraph_app_install_status",
      "loopgraph_app_operation_resolve",
      "loopgraph_app_operation_invoke",
      "loopgraph_app_operation_actions_get",
      "loopgraph_app_operation_action_commit",
      "loopgraph_app_operation_action_reconcile",
      "loopgraph_app_maturity_get",
      "loopgraph_apps_renewal_plan",
      "loopgraph_app_verification_registry_get",
      "loopgraph_app_verifier_trust_add",
      "loopgraph_app_verifier_trust_revoke",
      "loopgraph_app_verification_import",
      "loopgraph_connector_schema_record",
      "loopgraph_app_field_mappings_get",
      "loopgraph_app_field_mapping_confirm",
      "loopgraph_app_test",
      "loopgraph_app_historical_replay",
      "loopgraph_app_evaluation_label",
      "loopgraph_app_promotion_recommendation",
      "loopgraph_app_configure",
      "loopgraph_app_overlay_apply",
      "loopgraph_app_repair",
      "loopgraph_app_duplicate",
      "loopgraph_app_diff",
      "loopgraph_app_update_plan",
      "loopgraph_app_update_apply",
      "loopgraph_app_rollback",
      "loopgraph_app_detach",
      "loopgraph_app_uninstall",
      "loopgraph_app_activation_gate_get",
      "loopgraph_app_activation_approve",
      "loopgraph_app_activate",
      "loopgraph_app_pause",
      "loopgraph_app_resume",
      "loopgraph_app_publisher_key_generate",
      "loopgraph_app_publisher_keys_get",
      "loopgraph_app_init",
      "loopgraph_app_capture",
      "loopgraph_app_dev",
      "loopgraph_app_preview",
      "loopgraph_app_validate",
      "loopgraph_app_pack",
      "loopgraph_app_sign",
      "loopgraph_app_publish",
      "loopgraph_app_release_status",
      "loopgraph_marketplace_sources_get",
      "loopgraph_marketplace_source_add",
      "loopgraph_marketplace_source_refresh"
    ]);
  });

  it("requires both source bindings when repair requests exact replay", () => {
    const base = {
      projectRoot: "/srv/loopgraph/main",
      installationId: "install.sales",
      actor: "admin"
    };
    expect(appRepairInputSchema.safeParse(base).success).toBe(false);
    expect(appRepairInputSchema.safeParse({
      ...base,
      expectedArtifactDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }).success).toBe(false);
    expect(appRepairInputSchema.safeParse({
      ...base,
      expectedArtifactDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedUpdatedAt: "2026-08-22T20:00:00.000Z"
    }).success).toBe(true);
  });

  it("requires both exact source bindings for replay-safe duplication", () => {
    const base = {
      projectRoot: "/srv/loopgraph/main",
      installationId: "install.sales",
      derivedAppId: "private.sales.qualify",
      overlayOperations: [],
      actor: "admin"
    };
    expect(appDuplicateInputSchema.safeParse(base).success).toBe(false);
    expect(appDuplicateInputSchema.safeParse({
      ...base,
      expectedArtifactDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }).success).toBe(false);
    expect(appDuplicateInputSchema.safeParse({
      ...base,
      expectedArtifactDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expectedUpdatedAt: "2026-08-22T21:00:00.000Z"
    }).success).toBe(true);
  });

  it("requires both exact source bindings for replay-safe detach", () => {
    const base = {
      projectRoot: "/srv/loopgraph/main",
      installationId: "install.private-sales",
      actor: "admin"
    };
    expect(appDetachInputSchema.safeParse(base).success).toBe(false);
    expect(appDetachInputSchema.safeParse({
      ...base,
      expectedArtifactDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }).success).toBe(false);
    expect(appDetachInputSchema.safeParse({
      ...base,
      expectedArtifactDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      expectedUpdatedAt: "2026-08-22T22:00:00.000Z"
    }).success).toBe(true);
  });

  it("exposes the same secret-free prepared-action ledger to Hermes and local callers", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-action-tool-"));
    temporaryDirectories.push(projectRoot);
    const result = await callLoopgraphAppTool("loopgraph_app_operation_actions_get", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      installationId: "installed-sales"
    }) as { schemaVersion: string; workspaceId: string; actions: unknown[] };
    expect(result).toEqual({
      schemaVersion: "loopgraph-app-operation-action-ledger/v1alpha1",
      workspaceId: "acme",
      actions: [],
      events: []
    });
  });

  it("uses the same publisher service for Hermes-facing init, validation, signing, and publishing", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-"));
    temporaryDirectories.push(projectRoot);
    const initialized = await callLoopgraphAppTool("loopgraph_app_init", {
      projectRoot,
      destination: "apps/product-learning",
      appId: "acme.product.product-learning",
      name: "Product Learning",
      department: "product",
      publisherId: "acme"
    }) as { packRoot: string };
    const developer = await callLoopgraphAppTool("loopgraph_app_dev", { projectRoot, packRoot: initialized.packRoot }) as { status: string; writeBlocked: boolean; inventory: { loops: unknown[] } };
    expect(developer).toMatchObject({ status: "ready", writeBlocked: true });
    expect(developer.inventory.loops).toHaveLength(1);
    const preview = await callLoopgraphAppTool("loopgraph_app_preview", { projectRoot, packRoot: initialized.packRoot }) as { status: string; providerWrites: number; scenarios: unknown[] };
    expect(preview).toMatchObject({ status: "passed", providerWrites: 0 });
    expect(preview.scenarios).toHaveLength(13);
    await writeFile(path.join(initialized.packRoot, "CHANGELOG.md"), `# Changelog\n\n${"safe release note\n".repeat(5_000)}`);
    const validation = await callLoopgraphAppTool("loopgraph_app_validate", { projectRoot, packRoot: initialized.packRoot }) as { ok: boolean };
    expect(validation.ok).toBe(true);
    const key = await callLoopgraphAppTool("loopgraph_app_publisher_key_generate", {
      projectRoot,
      publisherId: "acme",
      keyId: "acme.product.release"
    }) as { keyId: string; publicKey: string; privateKeyStored: boolean };
    expect(key).toMatchObject({ keyId: "acme.product.release", privateKeyStored: true });
    expect(key.publicKey).toContain("BEGIN PUBLIC KEY");
    await callLoopgraphAppTool("loopgraph_app_sign", { projectRoot, packRoot: initialized.packRoot, keyId: key.keyId });
    const published = await callLoopgraphAppTool("loopgraph_app_publish", {
      projectRoot,
      packRoot: initialized.packRoot,
      catalogId: "acme.private"
    }) as { sourceId: string };
    const sources = await callLoopgraphAppTool("loopgraph_marketplace_sources_get", { projectRoot }) as { sources: Array<{ id: string }> };
    expect(sources.sources.map((source) => source.id)).toContain(published.sourceId);
    const detail = await callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot,
      appId: "acme.product.product-learning"
    }) as { changelog?: string };
    expect(Buffer.byteLength(detail.changelog ?? "", "utf8")).toBeLessThan(66 * 1024);
    expect(detail.changelog).toMatch(/Changelog truncated to 64 KiB/);
  });

  it("discovers official apps and returns an immutable app detail contract", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-"));
    temporaryDirectories.push(projectRoot);

    const search = await callLoopgraphAppTool("loopgraph_marketplace_search", {
      projectRoot,
      query: "qualify inbound leads"
    }) as { count: number; results: Array<{ app: { id: string } }> };
    expect(search.count).toBeGreaterThan(0);
    expect(search.results[0]?.app.id).toBe("loopgraph.sales.qualify-route-inbound-leads");

    const detail = await callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads"
    }) as {
      selectedVersion: { version: string; digest: string };
      provenance: { verified: boolean };
      manifest: { metadata: { id: string } };
      audience: { department: string; ownerRole: string; reviewRoles: string[] };
      problemSolved: string;
      loops: unknown[];
      skills: unknown[];
      setupQuestions: unknown[];
      sampleOutputs: Array<{ loopId: string; loopName: string; metric?: string }>;
      limitations: string[];
      previewAvailability: {
        synthetic: boolean;
        sampleDataset: boolean;
        historicalReadOnlyRequiresInstallation: boolean;
      };
      versionHistory: Array<{ version: string; digest: string; maturity: string; sourceId: string }>;
      changelog?: string;
      evaluationSummary: { scenarios: number };
      graphPreview: { nodes: Array<{ type: string }> };
    };
    expect(detail.manifest.metadata.id).toBe("loopgraph.sales.qualify-route-inbound-leads");
    expect(detail.selectedVersion.version).toBe("1.0.0");
    expect(detail.selectedVersion.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(detail.provenance.verified).toBe(true);
    expect(detail.audience).toMatchObject({ department: "sales", ownerRole: "sales_operations" });
    expect(detail.audience.reviewRoles).toContain("sales_manager");
    expect(detail.problemSolved).toMatch(/inbound lead/i);
    expect(detail.loops).toHaveLength(6);
    expect(detail.skills).toHaveLength(4);
    expect(detail.setupQuestions).toHaveLength(10);
    expect(detail.sampleOutputs.length).toBeGreaterThanOrEqual(6);
    expect(detail.sampleOutputs.some((output) => output.loopId.includes("lead-qualification") && output.metric)).toBe(true);
    expect(detail.limitations).toHaveLength(4);
    expect(detail.limitations.join(" ")).toMatch(/do not prove production business value/i);
    expect(detail.previewAvailability).toEqual({
      synthetic: true,
      sampleDataset: true,
      historicalReadOnlyRequiresInstallation: true
    });
    expect(detail.versionHistory).toHaveLength(1);
    expect(detail.versionHistory[0]).toMatchObject({ version: "1.0.0", maturity: "tested", sourceId: "loopgraph-official" });
    expect(detail.versionHistory[0]?.digest).toBe(detail.selectedVersion.digest);
    expect(detail.changelog).toMatch(/Initial six-loop Sales application/);
    expect(detail.evaluationSummary.scenarios).toBe(14);
    expect(detail.graphPreview.nodes.some((node) => node.type === "app")).toBe(true);
  });

  it("returns curated Department Packs without installing or activating Apps", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-department-pack-tools-"));
    temporaryDirectories.push(projectRoot);

    const search = await callLoopgraphAppTool("loopgraph_department_packs_search", {
      projectRoot,
      query: "pipeline leads"
    }) as { results: Array<{ pack: { id: string } }> };
    expect(search.results[0]?.pack.id).toBe("loopgraph.department.sales");

    const detail = await callLoopgraphAppTool("loopgraph_department_pack_get", {
      projectRoot,
      packId: "loopgraph.department.sales"
    }) as {
      applications: Array<{ app: { id: string }; installation?: unknown }>;
      progress: { installed: number; total: number; complete: boolean };
      nextAction: { action: string; tool: string; appId: string };
    };
    expect(detail.applications.map((entry) => entry.app.id)).toEqual([
      "loopgraph.sales.qualify-route-inbound-leads",
      "loopgraph.sales.find-recover-cold-deals"
    ]);
    expect(detail.applications.every((entry) => !entry.installation)).toBe(true);
    expect(detail.progress).toEqual({ installed: 0, total: 2, complete: false });
    expect(detail.nextAction).toMatchObject({
      action: "onboard_app",
      tool: "loopgraph_app_onboarding_get",
      appId: "loopgraph.sales.qualify-route-inbound-leads"
    });

    const status = await callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as { installations: unknown[] };
    expect(status.installations).toEqual([]);
  });

  it("returns a company-wide Hermes Blueprint without seeding the workspace", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-company-blueprint-tools-"));
    temporaryDirectories.push(projectRoot);

    const search = await callLoopgraphAppTool("loopgraph_company_blueprints_search", {
      projectRoot,
      query: "saas recurring revenue"
    }) as { results: Array<{ blueprint: { id: string } }> };
    expect(search.results[0]?.blueprint.id).toBe("loopgraph.company.saas-operating-system");

    const detail = await callLoopgraphAppTool("loopgraph_company_blueprint_get", {
      projectRoot,
      blueprintId: "loopgraph.company.saas-operating-system"
    }) as {
      departmentPacks: Array<{ pack: { id: string }; progress: { complete: boolean } }>;
      progress: { completedPacks: number; totalPacks: number; installedApps: number; totalApps: number; complete: boolean };
      nextAction: { action: string; tool: string; packId: string };
    };
    expect(detail.departmentPacks).toHaveLength(9);
    expect(detail.departmentPacks.every((entry) => !entry.progress.complete)).toBe(true);
    expect(detail.progress).toEqual({ completedPacks: 0, totalPacks: 9, installedApps: 0, totalApps: 13, complete: false });
    expect(detail.nextAction).toMatchObject({
      action: "open_department_pack",
      tool: "loopgraph_department_pack_get",
      packId: "loopgraph.department.product"
    });
    const status = await callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as { installations: unknown[] };
    expect(status.installations).toEqual([]);
  });

  it("lets Hermes read approved company context but requires an accountable approval to persist it", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-company-context-tools-"));
    temporaryDirectories.push(projectRoot);
    const initial = await callLoopgraphAppTool("loopgraph_company_context_get", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company"
    }) as { revision: number; values: unknown[] };
    expect(initial).toMatchObject({ revision: 0, values: [] });

    await callLoopgraphAppTool("loopgraph_company_context_approve", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      expectedRevision: 0,
      approvedBy: "founder@example.com",
      proposal: {
        key: "company.primaryGoal",
        type: "string",
        value: "Increase qualified expansion revenue",
        provenance: { source: "hermes_inference", sourceRef: "discovery.session-1" },
        confidence: 0.91,
        owner: "management",
        visibility: "workspace",
        explanation: "Hermes inferred this goal from the reviewed founder interview."
      }
    }, { now: new Date("2026-08-21T16:30:00.000Z") });
    const approved = await callLoopgraphAppTool("loopgraph_company_context_get", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company"
    }) as { revision: number; values: Array<{ key: string; verified: boolean; confirmedBy?: string }> };
    expect(approved).toMatchObject({ revision: 1 });
    expect(approved.values).toContainEqual(expect.objectContaining({
      key: "company.primaryGoal",
      verified: true,
      confirmedBy: "founder@example.com"
    }));

    await expect(callLoopgraphAppTool("loopgraph_company_context_approve", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme-company",
      expectedRevision: 1,
      approvedBy: "founder@example.com",
      proposal: {
        key: "company.crm",
        type: "object",
        value: { access_token: "secret-value-that-must-not-persist" },
        provenance: { source: "user" },
        confidence: 1,
        owner: "management",
        explanation: "Invalid credential-bearing context."
      }
    })).rejects.toThrow(/Secret-like material was blocked/);
  });

  it("keeps a clean local workspace empty until an exact plan is installed", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-"));
    temporaryDirectories.push(projectRoot);

    const status = await callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as {
      installations: unknown[];
      readiness: unknown[];
      lock: unknown;
    };
    expect(status.installations).toEqual([]);
    expect(status.readiness).toEqual([]);
    expect(status.lock).toBeUndefined();

    const renewalPlan = await callLoopgraphAppTool("loopgraph_apps_renewal_plan", { projectRoot }) as {
      totalInstallations: number;
      totalMatched: number;
      counts: Record<string, number>;
      items: unknown[];
    };
    expect(renewalPlan).toMatchObject({ totalInstallations: 0, totalMatched: 0, items: [] });
    expect(Object.values(renewalPlan.counts).reduce((total, count) => total + count, 0)).toBe(0);

    const plan = await callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack",
      configuration: {},
      fieldMappingIds: []
    }) as {
      missingConfigurationKeys: string[];
      capabilityResolutions: Array<{ required: boolean; status: string }>;
    };
    expect(plan.missingConfigurationKeys.length).toBeGreaterThan(0);
    expect(plan.capabilityResolutions.some((resolution) => resolution.required && resolution.status === "missing")).toBe(true);

    const unchanged = await callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as { installations: unknown[] };
    expect(unchanged.installations).toEqual([]);
  });

  it("accepts a trusted, secret-free Hermes Broker projection for install planning", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-broker-"));
    temporaryDirectories.push(projectRoot);
    const connection = connectionInstanceFromBrokerInstallation(connectorInstallationViewSchema.parse({
      id: "provider_hubspot_main",
      tenant: { organizationId: "org-acme", projectKey: "main" },
      providerId: "hubspot",
      displayName: "Acme HubSpot",
      environment: "production",
      status: "active",
      grantedScopes: ["crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read"],
      allowedCapabilities: ["provider.data.read", "provider.health.read", "provider.webhooks.verify"],
      webhookStatus: "active",
      customerManagedKeyConfigured: true,
      createdAt: "2026-08-10T09:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z"
    }));
    const plan = await callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack",
      configuration: {}
    }, { connections: [connection] }) as {
      capabilityResolutions: Array<{ capability: string; required: boolean; status: string; connectionId?: string }>;
    };
    expect(plan.capabilityResolutions.filter((resolution) => resolution.required)).toEqual([
      expect.objectContaining({ capability: "crm.lead.read", status: "reusable", connectionId: "provider_hubspot_main" }),
      expect.objectContaining({ capability: "crm.account.read", status: "reusable", connectionId: "provider_hubspot_main" })
    ]);
  });

  it("records a provider schema, suggests mappings, and requires explicit confirmation before install readiness", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-tools-"));
    temporaryDirectories.push(projectRoot);
    await callLoopgraphConnectionTool("loopgraph_connections_register", {
      projectRoot,
      id: "hubspot-production",
      manifestId: "hubspot",
      capabilityKeys: ["crm.read"],
      grantedScopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
      status: "connected",
      environment: "live",
      readPolicy: "read_only",
      writePolicy: "approved_only"
    });
    await callLoopgraphAppTool("loopgraph_connector_schema_record", {
      projectRoot,
      connectionId: "hubspot-production",
      providerId: "hubspot",
      source: "provider_api",
      samplePolicy: "redacted_only",
      objects: [
        {
          objectType: "lead",
          fields: [
            { name: "hs_object_id", label: "Record ID", type: "string", writable: false, sampleValues: ["redacted-1"] },
            { name: "email", label: "Email", type: "string", writable: true, sampleValues: ["masked@example.com"] },
            { name: "company", label: "Company", type: "string", writable: true, sampleValues: ["Example Co"] },
            { name: "lifecyclestage", label: "Lifecycle stage", type: "enum", writable: true, sampleValues: ["lead"] }
          ]
        },
        {
          objectType: "account",
          fields: [
            { name: "hs_object_id", label: "Record ID", type: "string", writable: false, sampleValues: ["company-1"] },
            { name: "domain", label: "Domain", type: "string", writable: true, sampleValues: ["example.com"] },
            { name: "lifecyclestage", label: "Customer status", type: "enum", writable: true, sampleValues: ["customer"] }
          ]
        }
      ],
      actor: "hermes-connector"
    });
    const before = await callLoopgraphAppTool("loopgraph_app_field_mappings_get", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack"
    }) as { complete: boolean; requirements: Array<{ objectType: string; schemaStatus: string; connectionId?: string; suggestions: Array<{ logicalField: string; providerField?: string; confidence: number }> }> };
    expect(before.complete).toBe(false);
    expect(before.requirements.find((requirement) => requirement.objectType === "lead")).toMatchObject({ schemaStatus: "connected_snapshot", connectionId: "hubspot-production" });
    const lead = before.requirements.find((requirement) => requirement.objectType === "lead")!;
    await callLoopgraphAppTool("loopgraph_app_field_mapping_confirm", {
      projectRoot,
      connectionId: "hubspot-production",
      objectType: "lead",
      mappings: lead.suggestions.filter((suggestion) => suggestion.providerField).map((suggestion) => ({
        logicalField: suggestion.logicalField,
        providerField: suggestion.providerField,
        direction: "read",
        confidence: suggestion.confidence
      })),
      actor: "sales-operations"
    });
    const account = before.requirements.find((requirement) => requirement.objectType === "account")!;
    await callLoopgraphAppTool("loopgraph_app_field_mapping_confirm", {
      projectRoot,
      connectionId: "hubspot-production",
      objectType: "account",
      mappings: account.suggestions.filter((suggestion) => suggestion.providerField).map((suggestion) => ({
        logicalField: suggestion.logicalField,
        providerField: suggestion.providerField,
        direction: "read",
        confidence: suggestion.confidence
      })),
      actor: "sales-operations"
    });
    const after = await callLoopgraphAppTool("loopgraph_app_field_mappings_get", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack"
    }) as { complete: boolean };
    expect(after.complete).toBe(true);
    const installPlan = await callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot,
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      presetId: "hubspot-gmail-slack",
      configuration: {}
    }) as { missingConfigurationKeys: string[]; fieldMappingIds: string[] };
    expect(installPlan.fieldMappingIds).toHaveLength(7);
    expect(installPlan.missingConfigurationKeys.filter((key) => key.startsWith("mapping"))).toEqual([]);
  });

  it("drives one resumable journey from stack selection through shadow operation", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-onboarding-"));
    temporaryDirectories.push(projectRoot);
    const appId = "loopgraph.sales.qualify-route-inbound-leads";

    const choose = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(choose).toMatchObject({
      stage: "choose_preset",
      nextAction: { kind: "choose_preset", requiresHumanConfirmation: true },
      evidence: { providerWritesBlocked: true }
    });
    expect(choose.app.presets.map((preset) => preset.id)).toEqual([
      "hubspot-gmail-slack",
      "salesforce-outlook-teams"
    ]);

    const configuration = {
      icpDefinition: { industries: ["software"], minimumEmployees: 50 },
      exclusions: ["existing_customer", "employee"],
      territories: { north_america: "sales-na" },
      qualificationThreshold: { qualified: 80, review: 60 },
      lifecycleStages: { new: "lead", qualified: "mql", accepted: "sal", disqualified: "other" }
    };
    const saved = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      projectRoot,
      appId,
      presetId: "hubspot-gmail-slack",
      configuration: { icpDefinition: configuration.icpDefinition },
      expectedDraftRevision: 0,
      actor: "sales-operations"
    }) as AppOnboardingJourney;
    expect(saved.draft).toMatchObject({ revision: 1, resumed: true, savedBy: "sales-operations" });

    const disconnected = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(disconnected.stage).toBe("connect_systems");
    expect(disconnected.draft).toMatchObject({ revision: 1, resumed: true });
    expect(disconnected.questions.length).toBeGreaterThan(0);
    expect(disconnected.blockers.some((blocker) => blocker.kind === "connection")).toBe(true);

    await callLoopgraphConnectionTool("loopgraph_connections_register", {
      projectRoot,
      id: "hubspot-production",
      manifestId: "hubspot",
      capabilityKeys: ["crm.read"],
      grantedScopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
      status: "connected",
      environment: "live",
      readPolicy: "read_only",
      writePolicy: "approved_only"
    });
    const completedAnswers = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      projectRoot,
      appId,
      presetId: "hubspot-gmail-slack",
      configuration,
      expectedDraftRevision: 1,
      actor: "sales-operations"
    }) as AppOnboardingJourney;
    expect(completedAnswers.draft).toMatchObject({ revision: 2 });
    const needsMappings = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(needsMappings.stage).toBe("confirm_mappings");
    expect(needsMappings.mappingPlan?.requirements.length).toBeGreaterThan(0);
    for (const requirement of needsMappings.mappingPlan!.requirements) {
      await callLoopgraphAppTool("loopgraph_app_field_mapping_confirm", {
        projectRoot,
        connectionId: requirement.connectionId,
        objectType: requirement.objectType,
        mappings: requirement.suggestions.filter((suggestion) => suggestion.providerField).map((suggestion) => ({
          logicalField: suggestion.logicalField,
          providerField: suggestion.providerField,
          direction: "read",
          confidence: suggestion.confidence
        })),
        actor: "sales-operations"
      });
    }

    const review = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(review).toMatchObject({
      stage: "review_install",
      blockers: [],
      nextAction: {
        kind: "call_tool",
        toolName: "loopgraph_app_install_apply",
        requiresHumanConfirmation: true
      }
    });
    expect(review.plan).toBeDefined();
    const applied = await callLoopgraphAppTool("loopgraph_app_install_apply", {
      projectRoot,
      plan: review.plan,
      actor: "sales-operations"
    }) as { installation: { id: string; appId: string; artifactDigest: string } };

    const rehearse = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }) as AppOnboardingJourney;
    expect(rehearse).toMatchObject({
      stage: "run_conformance",
      nextAction: { toolName: "loopgraph_app_test", requiresHumanConfirmation: false }
    });
    const conformance = await callLoopgraphAppTool("loopgraph_app_test", {
      projectRoot,
      installationId: applied.installation.id,
      actor: "hermes"
    }) as { status: string; writeBlocked: boolean };
    expect(conformance).toMatchObject({ status: "passed", writeBlocked: true });
    const maturity = await callLoopgraphAppTool("loopgraph_app_maturity_get", {
      projectRoot,
      installationId: applied.installation.id
    }, readyHermesRoutingOptions) as { maturity: string; gates: Array<{ level: string; status: string }> };
    expect(maturity).toMatchObject({
      maturity: "connected",
      gates: [
        { level: "tested", status: "achieved" },
        { level: "connected", status: "achieved" },
        { level: "production_proven", status: "blocked" },
        { level: "loopgraph_verified", status: "blocked" }
      ]
    });

    const verifierKeys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    await callLoopgraphAppTool("loopgraph_app_verifier_trust_add", {
      projectRoot,
      key: {
        verifierId: "independent-auditor",
        keyId: "independent-auditor.primary",
        algorithm: "ed25519",
        publicKey: verifierKeys.publicKey,
        approvedBy: "security-admin",
        approvalRef: "change:SEC-44",
        approvedAt: "2026-08-21T12:00:00.000Z"
      }
    });
    const verificationReceipt = createAppIndependentVerificationReceipt({
      installationId: applied.installation.id,
      appId: applied.installation.appId,
      artifactDigest: applied.installation.artifactDigest,
      verifierId: "independent-auditor",
      verifierType: "accredited_third_party",
      status: "passed",
      evidenceRefs: ["audit:independent-review"],
      verifiedAt: "2026-08-21T12:00:00.000Z",
      keyId: "independent-auditor.primary",
      privateKeyPem: verifierKeys.privateKey
    });
    const imported = await callLoopgraphAppTool("loopgraph_app_verification_import", {
      projectRoot,
      receipt: verificationReceipt,
      importedBy: "security-admin",
      importRef: "change:SEC-47"
    }) as { receipts: unknown[]; privateKeyMaterialAccepted: boolean };
    expect(imported).toMatchObject({ receipts: [verificationReceipt], privateKeyMaterialAccepted: false });
    const verificationStatus = await callLoopgraphAppTool("loopgraph_app_verification_registry_get", {
      projectRoot
    }) as { trustedVerifierKeys: unknown[]; receipts: unknown[]; privateKeyMaterialAccepted: boolean };
    expect(verificationStatus).toMatchObject({
      trustedVerifierKeys: [expect.objectContaining({ verifierId: "independent-auditor" })],
      receipts: [verificationReceipt],
      privateKeyMaterialAccepted: false
    });
    const revoked = await callLoopgraphAppTool("loopgraph_app_verifier_trust_revoke", {
      projectRoot,
      verifierId: "independent-auditor",
      keyId: "independent-auditor.primary",
      revokedBy: "security-admin",
      revocationRef: "incident:IR-10"
    }) as { trustedVerifierKeys: Array<{ revokedAt?: string; revokedBy?: string }> };
    expect(revoked.trustedVerifierKeys[0]).toMatchObject({ revokedBy: "security-admin" });

    const routeSync = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }) as AppOnboardingJourney;
    expect(routeSync).toMatchObject({
      stage: "activate_shadow",
      nextAction: {
        toolName: "loopgraph_hermes_webhooks_sync",
        requiresHumanConfirmation: true,
        input: { dryRun: false }
      }
    });
    await callLoopgraphHermesWebhookTool("loopgraph_hermes_webhooks_sync", { projectRoot });
    const routeActivation = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }) as AppOnboardingJourney;
    expect(routeActivation).toMatchObject({
      stage: "activate_shadow",
      nextAction: {
        toolName: "loopgraph_hermes_webhooks_prepare",
        requiresHumanConfirmation: false
      }
    });

    const activate = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }, readyHermesRoutingOptions) as AppOnboardingJourney;
    expect(activate).toMatchObject({
      stage: "activate_shadow",
      nextAction: {
        toolName: "loopgraph_app_activation_approve",
        requiresHumanConfirmation: true,
        input: { installationId: applied.installation.id, mode: "shadow" }
      }
    });
    const shadowGate = await callLoopgraphAppTool("loopgraph_app_activation_gate_get", {
      projectRoot,
      installationId: applied.installation.id,
      mode: "shadow"
    }, readyHermesRoutingOptions) as { status: string; requiredMaturity: string; gateDigest: string };
    expect(shadowGate).toMatchObject({
      status: "ready",
      requiredMaturity: "connected",
      gateDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    });
    const approval = await callLoopgraphAppTool("loopgraph_app_activation_approve", {
      projectRoot,
      installationId: applied.installation.id,
      mode: "shadow",
      approvedBy: "sales-operations",
      reason: "The write-blocked rehearsal passed and shadow routing is approved.",
      evidenceRefs: ["operator-review:shadow"]
    }, readyHermesRoutingOptions) as { receipt: { id: string; schemaVersion: string; activationGate: { gateDigest: string; status: string; requiredMaturity: string } }; nextAction: { toolName: string; input: { approvalReceiptId: string } } };
    expect(approval.receipt).toMatchObject({
      schemaVersion: "loopgraph-app-activation-approval/v1alpha2",
      activationGate: {
        gateDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        status: "ready",
        requiredMaturity: "connected"
      }
    });
    expect(approval.nextAction).toMatchObject({
      toolName: "loopgraph_app_activate",
      input: { approvalReceiptId: approval.receipt.id }
    });
    const approvalStatus = await callLoopgraphAppTool("loopgraph_app_install_status", {
      projectRoot,
      installationId: applied.installation.id
    }, readyHermesRoutingOptions) as { activationApprovals: Array<{ id: string; consumedAt?: string }> };
    expect(approvalStatus.activationApprovals).toHaveLength(1);
    expect(approvalStatus.activationApprovals[0]).toMatchObject({ id: approval.receipt.id });
    expect(approvalStatus.activationApprovals[0]?.consumedAt).toBeUndefined();
    const approvedJourney = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }, readyHermesRoutingOptions) as AppOnboardingJourney;
    expect(approvedJourney).toMatchObject({
      stage: "activate_shadow",
      nextAction: {
        toolName: "loopgraph_app_activate",
        requiresHumanConfirmation: false,
        input: { installationId: applied.installation.id, mode: "shadow", approvalReceiptId: approval.receipt.id }
      }
    });
    await callLoopgraphAppTool("loopgraph_app_activate", {
      projectRoot,
      installationId: applied.installation.id,
      mode: "shadow",
      approvalReceiptId: approval.receipt.id,
      actor: "sales-operations"
    }, readyHermesRoutingOptions);
    const consumedStatus = await callLoopgraphAppTool("loopgraph_app_install_status", {
      projectRoot,
      installationId: applied.installation.id
    }, readyHermesRoutingOptions) as { activationApprovals: Array<{ id: string; consumedAt?: string; consumedBy?: string }> };
    expect(consumedStatus.activationApprovals).toEqual([
      expect.objectContaining({ id: approval.receipt.id, consumedBy: "sales-operations" })
    ]);
    const operating = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }, readyHermesRoutingOptions) as AppOnboardingJourney;
    expect(operating).toMatchObject({
      stage: "operate",
      progress: { completed: 7, total: 8 },
      nextAction: { kind: "monitor", requiresHumanConfirmation: false },
      evidence: { syntheticStatus: "passed", providerWritesBlocked: true }
    });
    expect(operating.draft).toBeUndefined();
  }, 45_000);

  it("rejects unsafe draft writes and resets only the exact confirmed draft", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-draft-security-"));
    temporaryDirectories.push(projectRoot);
    const appId = "loopgraph.sales.qualify-route-inbound-leads";
    const base = {
      projectRoot,
      appId,
      presetId: "hubspot-gmail-slack",
      configuration: { exclusions: ["employee"] },
      expectedDraftRevision: 0,
      actor: "sales-operations"
    };
    const saved = await callLoopgraphAppTool("loopgraph_app_onboarding_save", base) as AppOnboardingJourney;
    expect(saved.draft).toMatchObject({ revision: 1 });
    const replayed = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      ...base,
      expectedDraftRevision: 0
    }) as AppOnboardingJourney;
    expect(replayed.draft).toMatchObject({ revision: 1, savedBy: "sales-operations" });

    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      ...base,
      configuration: { exclusions: ["contractor"] }
    })).rejects.toThrow(/revision conflict/i);
    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      ...base,
      expectedDraftRevision: 1,
      configuration: { access_token: "secret-value-that-must-never-persist" }
    })).rejects.toThrow(/secret/i);
    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      ...base,
      expectedDraftRevision: 1,
      configuration: { undeclaredBusinessRule: "never" }
    })).rejects.toThrow(/undeclared configuration key/i);

    const resumed = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(resumed.plan?.configuration.values.exclusions).toEqual(["employee"]);
    expect(resumed.draft).toMatchObject({ revision: 1, resumed: true });

    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
      projectRoot,
      appId,
      expectedDraftId: "draft.wrong",
      expectedDraftRevision: 1,
      confirmReset: true,
      actor: "sales-operations"
    })).rejects.toThrow(/identity conflict/i);
    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
      projectRoot,
      appId,
      expectedDraftId: resumed.draft!.id,
      expectedDraftRevision: 1,
      actor: "sales-operations"
    })).rejects.toThrow();

    const reset = await callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
      projectRoot,
      appId,
      expectedDraftId: resumed.draft!.id,
      expectedDraftRevision: 1,
      confirmReset: true,
      actor: "sales-operations"
    }) as { result: string; draftId: string; draftRevision: number; actor: string };
    expect(reset).toMatchObject({
      result: "cleared",
      draftId: resumed.draft!.id,
      draftRevision: 1,
      actor: "sales-operations"
    });
    const retry = await callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
      projectRoot,
      appId,
      expectedDraftId: resumed.draft!.id,
      expectedDraftRevision: 1,
      confirmReset: true,
      actor: "sales-operations"
    }) as { result: string };
    expect(retry.result).toBe("already_cleared");

    const restarted = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(restarted).toMatchObject({ stage: "choose_preset" });
    expect(restarted.draft).toBeUndefined();

    const replacement = await callLoopgraphAppTool("loopgraph_app_onboarding_save", base) as AppOnboardingJourney;
    expect(replacement.draft?.id).not.toBe(resumed.draft!.id);
    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
      projectRoot,
      appId,
      expectedDraftId: resumed.draft!.id,
      expectedDraftRevision: 1,
      confirmReset: true,
      actor: "sales-operations"
    })).rejects.toThrow(/identity conflict/i);
  }, 20_000);

  it("keeps an explicit preset preview isolated until the saved draft transition is confirmed", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-preset-transition-"));
    temporaryDirectories.push(projectRoot);
    const appId = "loopgraph.sales.qualify-route-inbound-leads";
    const saved = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      projectRoot,
      appId,
      presetId: "hubspot-gmail-slack",
      configuration: { exclusions: ["employee"] },
      expectedDraftRevision: 0,
      actor: "sales-operations"
    }) as AppOnboardingJourney;

    const preview = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      presetId: "salesforce-outlook-teams"
    }) as AppOnboardingJourney;
    expect(preview.app.presetId).toBe("salesforce-outlook-teams");
    expect(preview.draft).toMatchObject({
      id: saved.draft!.id,
      presetId: "hubspot-gmail-slack",
      revision: 1,
      applied: false,
      resumed: false
    });
    expect(preview.plan?.configuration.values.exclusions).toBeUndefined();

    const replacement = {
      projectRoot,
      appId,
      presetId: "salesforce-outlook-teams",
      configuration: { exclusions: ["contractor"] },
      expectedDraftRevision: 1,
      actor: "sales-operations"
    };
    await expect(callLoopgraphAppTool("loopgraph_app_onboarding_save", replacement))
      .rejects.toThrow(/requires explicit confirmation/i);

    const confirmed = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      ...replacement,
      confirmPresetChange: true
    }) as AppOnboardingJourney;
    expect(confirmed.draft).toMatchObject({
      id: saved.draft!.id,
      presetId: "salesforce-outlook-teams",
      revision: 2,
      applied: true
    });
    const resumed = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId
    }) as AppOnboardingJourney;
    expect(resumed.app.presetId).toBe("salesforce-outlook-teams");
    expect(resumed.plan?.configuration.values.exclusions).toEqual(["contractor"]);
  }, 20_000);

  it("emits bounded actor-attributed audit context for draft save and reset", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-app-onboarding-audit-"));
    temporaryDirectories.push(projectRoot);
    const appId = "loopgraph.sales.qualify-route-inbound-leads";
    const store = new AuditCapturingInstallationStore("acme");
    const options = { appInstallationStoreFactory: () => store };
    const saved = await callLoopgraphAppTool("loopgraph_app_onboarding_save", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme",
      appId,
      presetId: "hubspot-gmail-slack",
      configuration: { exclusions: ["employee"] },
      expectedDraftRevision: 0,
      actor: "sales-operations"
    }, options) as AppOnboardingJourney;

    const saveAudit = store.audits[0];
    expect(saveAudit).toMatchObject({
      actor: "sales-operations",
      action: "app.onboarding_draft.saved",
      targetType: "app_onboarding_draft",
      targetId: saved.draft!.id,
      metadata: {
        draftRevision: 1,
        presetChanged: false,
        answerCount: 1,
        fieldMappingCount: 0
      }
    });
    if (!saveAudit || (saveAudit.action !== "app.onboarding_draft.saved" && saveAudit.action !== "app.onboarding_draft.reset")) {
      throw new Error("Expected an onboarding draft audit event");
    }
    expect(saveAudit.metadata.appIdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(saveAudit.metadata.presetIdDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    await callLoopgraphAppTool("loopgraph_app_onboarding_reset", {
      projectRoot,
      workspaceId: "acme",
      companyId: "acme",
      appId,
      expectedDraftId: saved.draft!.id,
      expectedDraftRevision: 1,
      confirmReset: true,
      actor: "sales-admin"
    }, options);
    expect(store.audits[1]).toMatchObject({
      actor: "sales-admin",
      action: "app.onboarding_draft.reset",
      targetId: saved.draft!.id,
      metadata: { draftRevision: 1, answerCount: 1 }
    });
    expect(JSON.stringify(store.audits)).not.toContain("employee");
    expect(JSON.stringify(store.audits)).not.toContain("hubspot-gmail-slack");
    expect(JSON.stringify(store.audits)).not.toContain(appId);
  });
});

class AuditCapturingInstallationStore implements AppInstallationStore {
  readonly persistence = "file" as const;
  readonly audits: AppInstallationMutationAuditContext[] = [];
  private registry: AppInstallationRegistry;

  constructor(workspaceId: string) {
    this.registry = emptyAppInstallationRegistry(workspaceId);
  }

  async read() {
    return this.registry;
  }

  async readLockfile() {
    return undefined;
  }

  async withExclusiveUpdate<T>(operation: (registry: AppInstallationRegistry) => Promise<AppInstallationUpdate<T>>): Promise<T> {
    const current = this.registry;
    const result = await operation(current);
    const next = appInstallationRegistrySchema.parse(result.registry);
    assertAppInstallationRegistryRevision(current, next);
    this.registry = next;
    if (result.audit) this.audits.push(result.audit);
    return result.value;
  }
}
