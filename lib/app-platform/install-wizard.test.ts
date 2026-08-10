import { describe, expect, it } from "vitest";
import { configurationFromInstallForm, installPlanBlockersForView } from "./install-wizard";

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
      permissions: [{ capability: "crm.lead.update", decision: "unresolved" }]
    } as never);

    expect(blockers).toEqual([
      "Resolve confirmation for icpDefinition.",
      "Resolve field mapping for lead / lead.email.",
      "Connect crm.lead.read (missing).",
      "Review permission crm.lead.update."
    ]);
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
