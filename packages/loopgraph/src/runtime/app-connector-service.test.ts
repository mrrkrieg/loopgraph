import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionInstanceSchema } from "../core";
import {
  FileConnectorFieldMappingStore,
  loadConnectorRecipes,
  resolveConnectorCapabilities,
  suggestFieldMappings,
  validateFieldMappingCoverage
} from "./app-connector-service";
import { loadLoopPackDirectory } from "./app-pack-loader";

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
});

