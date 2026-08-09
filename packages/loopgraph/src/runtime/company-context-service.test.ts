import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_CONFIGURATION_SCHEMA_VERSION,
  APP_SETUP_SCHEMA_VERSION,
  appSetupDefinitionSchema,
  type AppConfigField
} from "../core";
import {
  FileCompanyContextStore,
  inferContextProposal,
  resolveAppConfiguration
} from "./company-context-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fields: AppConfigField[] = appSetupDefinitionSchema.parse({
  schemaVersion: APP_SETUP_SCHEMA_VERSION,
  kind: "AppSetup",
  questions: [
    {
      key: "icpDefinition",
      prompt: "What is the ICP?",
      why: "Qualification needs company policy.",
      valueType: "object",
      requirement: "required",
      inferFromContext: "sales.icp",
      confirmWhenInferred: true
    },
    {
      key: "followUpSlaMinutes",
      prompt: "What is the SLA?",
      why: "Latency needs a target.",
      valueType: "number",
      requirement: "required",
      inferFromContext: "sales.inboundSlaMinutes",
      confirmWhenInferred: true,
      defaultValue: 30
    }
  ]
}).questions.map((question) => ({
  key: question.key,
  label: question.prompt,
  description: question.why,
  valueType: question.valueType,
  requirement: question.requirement,
  infer: true,
  ask: true,
  sensitive: false,
  contextRef: question.inferFromContext,
  defaultValue: question.defaultValue
}));

describe("company context and configuration resolution", () => {
  it("requires approval before inferred context becomes shared and preserves provenance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-context-"));
    temporaryDirectories.push(root);
    const store = new FileCompanyContextStore(path.join(root, "context.json"));
    const initial = await store.get("acme", "acme-company");
    const proposal = inferContextProposal({
      field: fields[0],
      candidateValue: { industries: ["software"], minimumEmployees: 50 },
      source: "hermes_inference",
      sourceRef: "discovery-session-1",
      confidence: 0.88,
      owner: "revenue_operations"
    });
    expect(proposal.explanation).toMatch(/confidence 0.88/);
    expect(initial.values).toHaveLength(0);
    const approved = await store.approveValue({
      workspaceId: "acme",
      companyId: "acme-company",
      proposal,
      approvedBy: "user-1",
      expectedRevision: 0,
      consumerInstallationId: "install-sales"
    });
    expect(approved.values[0]).toMatchObject({ key: "sales.icp", verified: true, confirmedBy: "user-1" });
    expect(approved.values[0].consumerInstallationIds).toEqual(["install-sales"]);
  });

  it("resolves deterministic precedence and asks only for missing values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "loopgraph-context-"));
    temporaryDirectories.push(root);
    const store = new FileCompanyContextStore(path.join(root, "context.json"));
    const proposal = inferContextProposal({
      field: fields[0],
      candidateValue: { industries: ["software"] },
      source: "provider",
      sourceRef: "crm-policy-record",
      confidence: 0.95,
      owner: "revenue_operations"
    });
    const context = await store.approveValue({
      workspaceId: "acme",
      companyId: "acme-company",
      proposal,
      approvedBy: "user-1",
      expectedRevision: 0
    });
    const resolved = resolveAppConfiguration({
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      version: "1.0.0",
      fields,
      presetValues: { followUpSlaMinutes: 45 },
      companyContext: context,
      installValues: { followUpSlaMinutes: 20 }
    });
    expect(resolved.configuration.schemaVersion).toBe(APP_CONFIGURATION_SCHEMA_VERSION);
    expect(resolved.configuration.values).toEqual({ icpDefinition: { industries: ["software"] }, followUpSlaMinutes: 20 });
    expect(resolved.configuration.provenance.icpDefinition.layer).toBe("company_context");
    expect(resolved.configuration.provenance.followUpSlaMinutes.layer).toBe("install_config");
    expect(resolved.missing).toHaveLength(0);
  });
});

