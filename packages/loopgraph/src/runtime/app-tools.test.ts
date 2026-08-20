import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectorInstallationViewSchema, type AppOnboardingJourney } from "../core";
import { callLoopgraphAppTool, LOOPGRAPH_APP_TOOL_NAMES } from "./app-tools";
import { callLoopgraphConnectionTool } from "./connection-tools";
import { connectionInstanceFromBrokerInstallation } from "./connector-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("shared Loopgraph App tools", () => {
  it("exposes the required marketplace and lifecycle surface", () => {
    expect(LOOPGRAPH_APP_TOOL_NAMES).toEqual([
      "loopgraph_department_packs_search",
      "loopgraph_department_pack_get",
      "loopgraph_marketplace_search",
      "loopgraph_app_get",
      "loopgraph_app_onboarding_get",
      "loopgraph_app_install_plan",
      "loopgraph_app_install_apply",
      "loopgraph_app_install_status",
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
      "loopgraph_app_activate",
      "loopgraph_app_pause",
      "loopgraph_app_resume",
      "loopgraph_app_publisher_key_generate",
      "loopgraph_app_publisher_keys_get",
      "loopgraph_app_init",
      "loopgraph_app_capture",
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
      loops: unknown[];
      skills: unknown[];
      setupQuestions: unknown[];
      evaluationSummary: { scenarios: number };
      graphPreview: { nodes: Array<{ type: string }> };
    };
    expect(detail.manifest.metadata.id).toBe("loopgraph.sales.qualify-route-inbound-leads");
    expect(detail.selectedVersion.version).toBe("1.0.0");
    expect(detail.selectedVersion.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(detail.provenance.verified).toBe(true);
    expect(detail.loops).toHaveLength(6);
    expect(detail.skills).toHaveLength(4);
    expect(detail.setupQuestions).toHaveLength(10);
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

    const disconnected = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      presetId: "hubspot-gmail-slack"
    }) as AppOnboardingJourney;
    expect(disconnected.stage).toBe("connect_systems");
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
    const configuration = {
      icpDefinition: { industries: ["software"], minimumEmployees: 50 },
      exclusions: ["existing_customer", "employee"],
      territories: { north_america: "sales-na" },
      qualificationThreshold: { qualified: 80, review: 60 },
      lifecycleStages: { new: "lead", qualified: "mql", accepted: "sal", disqualified: "other" }
    };
    const needsMappings = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      presetId: "hubspot-gmail-slack",
      configuration
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
      appId,
      presetId: "hubspot-gmail-slack",
      configuration
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
    }) as { installation: { id: string } };

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

    const activate = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }) as AppOnboardingJourney;
    expect(activate).toMatchObject({
      stage: "activate_shadow",
      nextAction: {
        toolName: "loopgraph_app_activate",
        requiresHumanConfirmation: true,
        input: { installationId: applied.installation.id, mode: "shadow" }
      }
    });
    await callLoopgraphAppTool("loopgraph_app_activate", {
      projectRoot,
      installationId: applied.installation.id,
      mode: "shadow",
      actor: "sales-operations"
    });
    const operating = await callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      installationId: applied.installation.id
    }) as AppOnboardingJourney;
    expect(operating).toMatchObject({
      stage: "operate",
      progress: { completed: 7, total: 8 },
      nextAction: { kind: "monitor", requiresHumanConfirmation: false },
      evidence: { syntheticStatus: "passed", providerWritesBlocked: true }
    });
  }, 15_000);
});
