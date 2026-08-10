import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionInstanceSchema, connectorInstallationViewSchema } from "../core";
import {
  FileConnectorFieldMappingStore,
  FileProviderSchemaSnapshotStore,
  loadConnectorRecipes,
  resolveConnectorCapabilities,
  suggestFieldMappings,
  validateFieldMappingCoverage
} from "./app-connector-service";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { connectionInstanceFromBrokerInstallation } from "./connector-registry";

const temporaryDirectories: string[] = [];
const packRoot = path.resolve(process.cwd(), "packs/official/sales/qualify-route-inbound-leads");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("logical connector and field mapping service", () => {
  it("uses the same app with either provider recipe and reports missing capabilities", async () => {
    const loaded = await loadLoopPackDirectory(packRoot);
    const recipes = await loadConnectorRecipes(loaded);
    const connection = connectionInstanceSchema.parse({
      schemaVersion: "connection-instance/v1alpha1",
      id: "hubspot-production",
      manifestId: "hubspot",
      capabilityKeys: ["crm.lead.read", "crm.account.read", "hubspot.contacts.update"],
      grantedScopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
      status: "connected",
      environment: "live",
      readPolicy: "read_only",
      writePolicy: "approved_only"
    });
    const resolutions = resolveConnectorCapabilities({
      requiredCapabilities: loaded.manifest.requiredCapabilities,
      optionalCapabilities: loaded.manifest.optionalCapabilities,
      recipes,
      connections: [connection],
      selectedRecipeId: "hubspot-gmail-slack"
    });
    expect(resolutions.find((resolution) => resolution.capability === "crm.lead.read")?.status).toBe("reusable");
    expect(resolutions.find((resolution) => resolution.capability === "mail.message.draft")?.status).toBe("missing");
  });

  it("resolves every capability against its own provider in a multi-provider recipe", async () => {
    const loaded = await loadLoopPackDirectory(packRoot);
    const recipes = await loadConnectorRecipes(loaded);
    const connection = (id: string, manifestId: string, capabilityKeys: string[], grantedScopes: string[]) => connectionInstanceSchema.parse({
      schemaVersion: "connection-instance/v1alpha1",
      id,
      manifestId,
      capabilityKeys,
      grantedScopes,
      status: "connected",
      environment: "live",
      readPolicy: "read_only",
      writePolicy: "approved_only"
    });
    const resolutions = resolveConnectorCapabilities({
      requiredCapabilities: loaded.manifest.requiredCapabilities,
      optionalCapabilities: loaded.manifest.optionalCapabilities,
      recipes,
      connections: [
        connection("hubspot-production", "hubspot", ["crm.lead.read", "crm.account.read", "crm.lead.update"], ["crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.contacts.write"]),
        connection("gmail-production", "gmail", ["mail.message.draft", "mail.message.send"], ["gmail.compose", "gmail.send"]),
        connection("slack-production", "slack", ["messaging.channel.post"], ["chat:write"])
      ],
      selectedRecipeId: "hubspot-gmail-slack"
    });
    expect(resolutions.find((resolution) => resolution.capability === "mail.message.draft")).toMatchObject({ status: "reusable", connectionId: "gmail-production" });
    expect(resolutions.find((resolution) => resolution.capability === "messaging.channel.post")).toMatchObject({ status: "reusable", connectionId: "slack-production" });
  });

  it("reuses an active Hermes Broker installation without copying its credential reference", async () => {
    const loaded = await loadLoopPackDirectory(packRoot);
    const recipes = await loadConnectorRecipes(loaded);
    const brokerConnection = connectionInstanceFromBrokerInstallation(connectorInstallationViewSchema.parse({
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
    const resolutions = resolveConnectorCapabilities({
      requiredCapabilities: loaded.manifest.requiredCapabilities,
      optionalCapabilities: loaded.manifest.optionalCapabilities,
      recipes,
      connections: [brokerConnection],
      selectedRecipeId: "hubspot-gmail-slack"
    });
    expect(resolutions.filter((resolution) => resolution.required)).toEqual([
      expect.objectContaining({ capability: "crm.lead.read", status: "reusable", connectionId: "provider_hubspot_main" }),
      expect.objectContaining({ capability: "crm.account.read", status: "reusable", connectionId: "provider_hubspot_main" })
    ]);
    expect(brokerConnection).not.toHaveProperty("credentialRef");
  });

  it("suggests explainable mappings and never silently confirms uncertain fields", () => {
    const suggestions = suggestFieldMappings({
      requiredLogicalFields: ["lead.email", "lead.employeeCount", "lead.lifecycleStage"],
      providerFields: [
        { name: "email", label: "Email", type: "string", writable: true },
        { name: "numberofemployees", label: "Number of Employees", type: "number", writable: true },
        { name: "custom_stage_x", label: "Lifecycle category", type: "enum", writable: true }
      ]
    });
    expect(suggestions.find((suggestion) => suggestion.logicalField === "lead.email")).toMatchObject({ providerField: "email", confidence: 1, requiresConfirmation: false });
    expect(suggestions.find((suggestion) => suggestion.logicalField === "lead.employeeCount")?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(suggestions.find((suggestion) => suggestion.logicalField === "lead.lifecycleStage")?.requiresConfirmation).toBe(true);
  });

  it("reuses confirmed mappings across installations and reports coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-mappings-"));
    temporaryDirectories.push(root);
    const store = new FileConnectorFieldMappingStore(path.join(root, "mappings.json"), "acme");
    const email = await store.saveConfirmed({
      connectionId: "hubspot-production",
      objectType: "lead",
      logicalField: "lead.email",
      providerField: "email",
      direction: "read",
      confidence: 1,
      confirmedBy: "admin-1",
      installationId: "install-sales"
    });
    await store.attachInstallation([email.id], "install-marketing");
    const mappings = await store.list();
    expect(mappings[0].dependentInstallationIds).toEqual(["install-marketing", "install-sales"]);
    expect(validateFieldMappingCoverage({
      requiredLogicalFields: ["lead.email", "lead.company"],
      mappings,
      connectionId: "hubspot-production",
      objectType: "lead"
    })).toEqual({ complete: false, missing: ["lead.company"], unverified: [] });
  });

  it("stores connection-bound provider schema snapshots and ignores expired snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-provider-schemas-"));
    temporaryDirectories.push(root);
    const store = new FileProviderSchemaSnapshotStore(path.join(root, "provider-schemas.json"), "acme");
    await store.save({
      connectionId: "hubspot-production",
      providerId: "hubspot",
      source: "provider_api",
      samplePolicy: "redacted_only",
      objects: [{ objectType: "lead", fields: [{ name: "email", type: "string", writable: true, sampleValues: ["masked@example.com"] }] }],
      inspectedAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-08-10T00:00:00.000Z",
      inspectedBy: "hermes-connector"
    });
    expect(await store.get("hubspot-production", new Date("2026-08-09T12:00:00.000Z"))).toMatchObject({ providerId: "hubspot", source: "provider_api" });
    expect(await store.get("hubspot-production", new Date("2026-08-10T00:00:00.000Z"))).toBeUndefined();
  });
});
