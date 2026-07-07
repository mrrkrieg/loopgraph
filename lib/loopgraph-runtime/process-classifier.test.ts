import { describe, expect, it } from "vitest";
import { buildDemoDiscoverySession, startDiscoverySession } from "./discovery-engine";
import { buildProcessInventory, inferDepartments, inferGoals } from "./process-classifier";

describe("process classifier", () => {
  it("creates company, department, process, and goal shapes from answers", async () => {
    const session = await buildDemoDiscoverySession();
    expect(inferDepartments(session).map((department) => department.departmentType)).toContain("marketing");
    expect(buildProcessInventory(session).map((process) => process.name)).toContain("Campaign performance review for high CAC");
    expect(inferGoals(session).map((goal) => goal.label)).toContain("Reduce cost per qualified customer.");
  });

  it("can start from minimal company answers", async () => {
    const session = await startDiscoverySession({
      persist: false,
      companyProfile: {
        id: "minimal",
        description: "B2B SaaS using CRM and support tools",
        primaryGoal: "Improve renewal health",
        tools: ["crm", "support"]
      }
    });
    expect(inferDepartments(session).length).toBeGreaterThan(1);
    expect(buildProcessInventory({ ...session, departmentProfiles: inferDepartments(session) }).length).toBeGreaterThan(0);
  });
});

