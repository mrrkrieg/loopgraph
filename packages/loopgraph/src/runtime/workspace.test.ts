import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOOPGRAPH_API_VERSION, LOOP_KIND } from "../core";
import {
  getWorkspaceRegistryPath,
  initLoopgraphWorkspace,
  inspectLoopgraphWorkspace,
  readLoopgraphWorkspace,
  writeLoopgraphWorkspace
} from "./workspace";

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-workspace-"));
}

describe("Loopgraph workspace registry", () => {
  it("initializes an explicit project-local workspace without enabling demo catalog content", async () => {
    const projectRoot = await temporaryProjectRoot();

    const registry = await initLoopgraphWorkspace({
      projectRoot,
      displayName: "Acme Brain",
      createdBy: "cli",
      now: new Date("2026-07-21T12:00:00.000Z")
    });

    expect(registry).toMatchObject({
      version: 1,
      schemaVersion: "workspace/v1alpha1",
      projectRoot,
      displayName: "Acme Brain",
      demoCatalogEnabled: false,
      registeredSpecs: [],
      initializedAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z"
    });
    expect(registry.projectRootId).toMatch(/^project_/);

    const inspect = await inspectLoopgraphWorkspace({ projectRoot });
    expect(inspect.exists).toBe(true);
    expect(inspect.registeredSpecCount).toBe(0);
    expect(inspect.registeredDepartments).toEqual([]);
    expect(inspect.directories.every((directory) => directory.exists)).toBe(true);
    await access(getWorkspaceRegistryPath(projectRoot));
  });

  it("normalizes legacy department identifiers when reading and writing the workspace registry", async () => {
    const projectRoot = await temporaryProjectRoot();
    await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
    await writeFile(getWorkspaceRegistryPath(projectRoot), `${JSON.stringify({
      version: 1,
      demoCatalogEnabled: true,
      registeredSpecs: [
        { id: "ops_loop", name: "Ops", path: "loops/ops.loopgraph.json", department: "operations_finance", addedAt: "2026-07-21T12:00:00.000Z" },
        { id: "people_loop", name: "People", path: "loops/people.loopgraph.json", department: "hr", addedAt: "2026-07-21T12:00:00.000Z" },
        { id: "risk_loop", name: "Risk", path: "loops/risk.loopgraph.json", department: "legal_security", addedAt: "2026-07-21T12:00:00.000Z" }
      ]
    }, null, 2)}\n`);

    const registry = await readLoopgraphWorkspace(projectRoot);

    expect(registry.registeredSpecs.map((spec) => spec.department)).toEqual([
      "ops_finance",
      "hr_talent",
      "legal_compliance"
    ]);

    await writeLoopgraphWorkspace(registry, projectRoot);
    const raw = await readFile(getWorkspaceRegistryPath(projectRoot), "utf8");
    expect(raw).toContain("ops_finance");
    expect(raw).toContain("hr_talent");
    expect(raw).toContain("legal_compliance");
    expect(raw).not.toContain("operations_finance");
    expect(raw).not.toContain("legal_security");
  });

  it("inspects registered departments and routing-ready specs", async () => {
    const projectRoot = await temporaryProjectRoot();
    const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
    await mkdir(path.dirname(specPath), { recursive: true });
    await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
    await initLoopgraphWorkspace({ projectRoot });
    const registry = await readLoopgraphWorkspace(projectRoot);
    await writeLoopgraphWorkspace({
      ...registry,
      registeredSpecs: [{
        id: "marketing_ads",
        name: "Ads",
        path: path.relative(projectRoot, specPath),
        department: "marketing",
        addedAt: "2026-07-21T12:00:00.000Z"
      }]
    }, projectRoot);

    const inspect = await inspectLoopgraphWorkspace({ projectRoot });

    expect(inspect.registeredSpecCount).toBe(1);
    expect(inspect.registeredDepartments).toEqual(["marketing"]);
    expect(inspect.routingReadySpecCount).toBe(1);
  });
});

function marketingAdsSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads",
      name: "Ads",
      version: "1.0.0",
      description: "Improve qualified acquisition efficiency."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe campaign signals." }]
    },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft review", writeCapable: false, riskLevel: "low" }],
    policy: {
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval: false, riskLevel: "low" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow"
    }
  };
}
