import { describe, expect, it } from "vitest";
import { appOnboardingProgressForView, buildAppInstallImpactView, configurationFromInstallForm, installPlanBlockersForView } from "./install-wizard";

describe("guided app installation", () => {
  it("parses typed setup answers without requiring YAML or JSON for ordinary fields", () => {
    const form = new FormData();
    form.set("config:name", "Acme");
    form.set("config:threshold", "0.82");
    form.set("config:enabled", "true");
    form.set("config:segments", "enterprise\nmid-market, startup");
    form.set("config:owners", '{"enterprise":"alice"}');
    const questions = [
      question("name", "string"),
      question("threshold", "number"),
      question("enabled", "boolean"),
      question("segments", "string_list"),
      question("owners", "object")
    ];

    expect(configurationFromInstallForm(form, questions)).toEqual({
      name: "Acme",
      threshold: 0.82,
      enabled: true,
      segments: ["enterprise", "mid-market", "startup"],
      owners: { enterprise: "alice" }
    });
  });

  it("turns plan gaps into plain-language next actions", () => {
    const blockers = installPlanBlockersForView({
      missingConfigurationKeys: ["confirmation:icpDefinition", "mapping:lead:lead.email"],
      capabilityResolutions: [{ capability: "crm.lead.read", required: true, status: "missing" }],
      permissions: [{ capability: "crm.lead.update", decision: "unresolved" }],
      conflicts: [{ kind: "shared_company_object", resourceId: "graph-node.object.account", blocking: true, reason: "Contract differs." }]
    } as never);

    expect(blockers).toEqual([
      "Resolve confirmation for icpDefinition.",
      "Resolve field mapping for lead / lead.email.",
      "Connect crm.lead.read (missing).",
      "Review permission crm.lead.update.",
      "Resolve shared company object conflict for graph-node.object.account: Contract differs."
    ]);
  });

  it("projects exact additions, reuse, metrics, and signed evidence edges for review", () => {
    const impact = buildAppInstallImpactView({
      assets: [
        { id: "loop.sales.qualify", kind: "loop_spec", action: "create" },
        { id: "graph-node.object.account", kind: "graph_node", action: "reuse" }
      ],
      graphDiff: { nodesReused: ["object.account"] },
      capabilityResolutions: [{ capability: "crm.lead.read", status: "reusable", connectionId: "hubspot.production" }],
      dependencyResolutions: [{ appId: "loopgraph.identity", version: "1.2.0", reused: true }],
      fieldMappingIds: ["mapping.lead.email"],
      conflicts: [],
      permissions: [{ capability: "crm.lead.read", authority: "read", decision: "allow", reason: "Read leads." }]
    } as never, {
      graphPreview: {
        nodes: [
          { id: "object.account", label: "Account", type: "company_object" },
          { id: "sales.qualify", label: "Lead Qualification", type: "loop" }
        ],
        edges: [
          { id: "account-to-qualify", source: "object.account", target: "sales.qualify", type: "evidence_in", reason: "Account evidence is required." }
        ]
      },
      sampleOutputs: [{ id: "qualified-rate", loopName: "Lead Qualification", metric: "qualified lead rate", direction: "increase" }]
    });

    expect(impact.additions).toEqual([{ id: "loop.sales.qualify", kind: "loop_spec" }]);
    expect(impact.reusedAssets).toEqual([{ id: "graph-node.object.account", kind: "graph_node" }]);
    expect(impact.reusedDependencies).toEqual([{ appId: "loopgraph.identity", version: "1.2.0" }]);
    expect(impact.metrics[0]?.metric).toBe("qualified lead rate");
    expect(impact.evidenceEdges).toEqual([expect.objectContaining({ source: "Account", target: "Lead Qualification", type: "evidence_in" })]);
  });

  it("projects only progress fields across the client boundary", () => {
    const progress = appOnboardingProgressForView({
      stage: "connect_systems",
      headline: "Connect the required CRM.",
      progress: { completed: 1, total: 8 },
      steps: [{ id: "connect", label: "Connect systems", status: "current", summary: "Connect CRM." }],
      nextAction: { kind: "connect_providers", summary: "Connect CRM.", requiresHumanConfirmation: true },
      plan: { planDigest: "should-not-cross-the-boundary" },
      mappingPlan: { requirements: ["large-provider-contract"] },
      questions: [{ key: "privateCompanyContext" }]
    } as never);

    expect(progress).toEqual({
      stage: "connect_systems",
      headline: "Connect the required CRM.",
      progress: { completed: 1, total: 8 },
      steps: [{ id: "connect", label: "Connect systems", status: "current", summary: "Connect CRM." }],
      nextAction: { kind: "connect_providers", summary: "Connect CRM.", requiresHumanConfirmation: true }
    });
    expect(JSON.stringify(progress)).not.toContain("should-not-cross-the-boundary");
    expect(JSON.stringify(progress)).not.toContain("privateCompanyContext");
  });
});

function question(key: string, valueType: "string" | "number" | "boolean" | "string_list" | "object") {
  return {
    key,
    prompt: key,
    why: "Required for installation",
    valueType,
    requirement: "required" as const,
    confirmWhenInferred: false
  };
}
