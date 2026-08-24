import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_SUPERVISOR_COMPONENTS,
  localSupervisorLockPath,
  prepareLocalLoopgraph,
  readLocalSupervisorStatus,
  runLocalLoopgraphSupervisor,
  runLocalSupervisorCycle,
  type LocalSupervisorDependencies
} from "./local-supervisor";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local Loopgraph setup", () => {
  it("creates an empty non-demo workspace and prepares Hermes without copying preview loops", async () => {
    const projectRoot = await temporaryProject();
    const setupHermes = vi.fn(async () => hermesSetupResult(projectRoot));
    const result = await prepareLocalLoopgraph({
      projectRoot,
      displayName: "Acme",
      activateHermes: false,
      now: new Date("2026-08-17T12:00:00.000Z")
    }, {
      setupHermes: setupHermes as LocalSupervisorDependencies["setupHermes"],
      syncRoutes: vi.fn(async () => routeSyncResult(projectRoot)) as unknown as LocalSupervisorDependencies["syncRoutes"],
      doctorRoutes: vi.fn(async () => routeDoctorResult(projectRoot)) as unknown as LocalSupervisorDependencies["doctorRoutes"],
      prepareStudio: vi.fn(async () => studioPlan(projectRoot)) as LocalSupervisorDependencies["prepareStudio"]
    });

    expect(result.readyToStart).toBe(true);
    expect(result.readyForHermes).toBe(false);
    expect(result.workspace).toEqual({ registeredSpecCount: 0, demoCatalogEnabled: false });
    expect(result.nextActions).toContain(
      "The workspace is intentionally empty. Use Hermes to discover or install the first app; no preview loops were copied locally."
    );
    expect(setupHermes).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot,
      activate: false
    }));
    const workspace = JSON.parse(await readFile(path.join(projectRoot, ".loopgraph", "workspace.json"), "utf8"));
    expect(workspace.registeredSpecs).toEqual([]);
    expect(workspace.demoCatalogEnabled).toBe(false);
  });
});

describe("local Loopgraph supervisor", () => {
  it("runs every managed service, persists aggregate health, and reports app updates", async () => {
    const projectRoot = await temporaryProject();
    const calls: string[] = [];
    const dependencies = healthyDependencies(projectRoot, calls);
    const status = await runLocalSupervisorCycle({
      projectRoot,
      supervisorId: "test-supervisor",
      now: new Date("2026-08-17T13:00:00.000Z")
    }, dependencies);

    expect(status.health).toBe("healthy");
    expect(status.components.map((component) => component.name)).toEqual(LOCAL_SUPERVISOR_COMPONENTS);
    expect(calls).toEqual([
      "workspace:init",
      "workspace:inspect",
      "hermes",
      "routes:sync",
      "routes:doctor",
      "connections",
      "measurements",
      "worker",
      "opportunities",
      "apps:status",
      "apps:diff:install_sales",
      "apps:renewal-plan",
      "controller"
    ]);
    expect(status.components.find((component) => component.name === "app_updates")?.details)
      .toMatchObject({
        installedApps: 1,
        updatesAvailable: 1,
        proofCurrent: 1,
        proofInvalid: 0,
        proofExpired: 0,
        proofRenewSoon: 0,
        renewalPlanTruncated: false
      });
    const persisted = await readLocalSupervisorStatus(projectRoot);
    expect(persisted).toEqual(status);
  });

  it("redacts a failed service and continues the remaining supervisor cycle", async () => {
    const projectRoot = await temporaryProject();
    const calls: string[] = [];
    const dependencies = healthyDependencies(projectRoot, calls);
    dependencies.reconcileConnections = vi.fn(async () => {
      calls.push("connections");
      throw new Error("Authorization: Bearer this-is-a-sensitive-token-value");
    }) as LocalSupervisorDependencies["reconcileConnections"];

    const status = await runLocalSupervisorCycle({
      projectRoot,
      supervisorId: "test-supervisor",
      now: new Date("2026-08-17T13:05:00.000Z")
    }, dependencies);

    expect(status.health).toBe("degraded");
    const connection = status.components.find((component) => component.name === "connections");
    expect(connection?.error).toContain("[REDACTED]");
    expect(connection?.error).not.toContain("sensitive-token");
    expect(calls).toContain("controller");
  });

  it("rejects a second supervisor while a live local owner holds the lock", async () => {
    const projectRoot = await temporaryProject();
    const lockPath = localSupervisorLockPath(projectRoot);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: "loopgraph-local-supervisor-lock/v1alpha1",
      supervisorId: "already-running",
      token: "0a8f1614-4bee-4e32-9d48-31ea890d38ce",
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: "2026-08-17T13:00:00.000Z"
    })}\n`);

    await expect(runLocalLoopgraphSupervisor({ projectRoot, once: true }, healthyDependencies(projectRoot, [])))
      .rejects.toThrow(`already running on PID ${process.pid}`);
  });

  it.each([
    ["invalid", "blocked", "repair invalid App evidence"],
    ["expired", "degraded", "renew expired App proof"],
    ["renew_soon", "degraded", "schedule the next bounded App proof renewal"],
    ["incomplete", "healthy", undefined],
    ["current", "healthy", undefined]
  ] as const)("maps %s App proof to %s supervisor health without renewing it", async (proofStatus, expectedHealth, expectedAction) => {
    const projectRoot = await temporaryProject();
    const calls: string[] = [];
    const dependencies = healthyDependencies(projectRoot, calls);
    dependencies.callAppTool = vi.fn(async (name, input) => {
      if (name === "loopgraph_app_install_status") {
        calls.push("apps:status");
        return { installations: [{ id: "install_sales" }] };
      }
      if (name === "loopgraph_app_diff") {
        calls.push(`apps:diff:${String((input as { installationId?: string }).installationId)}`);
        return {};
      }
      if (name === "loopgraph_apps_renewal_plan") {
        calls.push("apps:renewal-plan");
        return fleetRenewalPlan(proofStatus);
      }
      throw new Error(`Unexpected App tool: ${name}`);
    }) as LocalSupervisorDependencies["callAppTool"];

    const status = await runLocalSupervisorCycle({
      projectRoot,
      supervisorId: "test-supervisor",
      components: ["app_updates"],
      now: new Date("2026-08-17T13:00:00.000Z")
    }, dependencies);

    expect(status.health).toBe(expectedHealth);
    expect(status.components).toHaveLength(1);
    if (proofStatus === "current") {
      expect(status.components[0]?.details).not.toHaveProperty("nextRenewalStatus");
    } else {
      expect(status.components[0]?.details).toMatchObject({
        nextRenewalStatus: proofStatus,
        nextRenewalActionKind: proofStatus === "invalid"
          ? "repair_evidence"
          : ["expired", "renew_soon"].includes(proofStatus)
            ? "renew_proof"
            : "complete_setup"
      });
    }
    if (expectedAction) expect(status.recommendedActions.join(" ")).toContain(expectedAction);
    else expect(status.recommendedActions.join(" ")).not.toMatch(/App proof|App evidence/);
    expect(calls).toEqual(["apps:status", "apps:diff:install_sales", "apps:renewal-plan"]);
  });

  it("fails the App fleet component closed when the renewal contract is malformed", async () => {
    const projectRoot = await temporaryProject();
    const calls: string[] = [];
    const dependencies = healthyDependencies(projectRoot, calls);
    dependencies.callAppTool = vi.fn(async (name, input) => {
      if (name === "loopgraph_app_install_status") {
        calls.push("apps:status");
        return { installations: [{ id: "install_sales" }] };
      }
      if (name === "loopgraph_app_diff") {
        calls.push(`apps:diff:${String((input as { installationId?: string }).installationId)}`);
        return {};
      }
      if (name === "loopgraph_apps_renewal_plan") {
        calls.push("apps:renewal-plan");
        return { schemaVersion: "untrusted-version", items: [] };
      }
      throw new Error(`Unexpected App tool: ${name}`);
    }) as LocalSupervisorDependencies["callAppTool"];

    const status = await runLocalSupervisorCycle({
      projectRoot,
      supervisorId: "test-supervisor",
      components: ["app_updates"],
      now: new Date("2026-08-17T13:00:00.000Z")
    }, dependencies);

    expect(status.health).toBe("blocked");
    expect(status.components[0]).toMatchObject({
      name: "app_updates",
      health: "blocked",
      summary: "App fleet check failed."
    });
    expect(status.components[0]?.error).toBeTruthy();
    expect(calls).toEqual(["apps:status", "apps:diff:install_sales", "apps:renewal-plan"]);
  });
});

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "loopgraph-supervisor-"));
  directories.push(directory);
  return directory;
}

function healthyDependencies(projectRoot: string, calls: string[]): Partial<LocalSupervisorDependencies> {
  return {
    initWorkspace: vi.fn(async (input) => {
      calls.push("workspace:init");
      return {
        version: 1,
        schemaVersion: "workspace/v1alpha1",
        projectRoot,
        projectRootId: "project_test",
        displayName: "Acme",
        demoCatalogEnabled: false,
        registeredSpecs: [],
        initializedAt: input.now?.toISOString() ?? "2026-08-17T13:00:00.000Z",
        updatedAt: input.now?.toISOString() ?? "2026-08-17T13:00:00.000Z"
      };
    }) as LocalSupervisorDependencies["initWorkspace"],
    inspectWorkspace: vi.fn(async () => {
      calls.push("workspace:inspect");
      return {
        exists: true,
        projectRoot,
        workspaceRoot: path.join(projectRoot, ".loopgraph"),
        registryPath: path.join(projectRoot, ".loopgraph", "workspace.json"),
        registry: {
          version: 1,
          schemaVersion: "workspace/v1alpha1",
          projectRoot,
          projectRootId: "project_test",
          displayName: "Acme",
          demoCatalogEnabled: false,
          registeredSpecs: [],
          initializedAt: "2026-08-17T13:00:00.000Z",
          updatedAt: "2026-08-17T13:00:00.000Z"
        },
        directories: [],
        registeredSpecCount: 0,
        registeredDepartments: [],
        routingReadySpecCount: 0
      };
    }) as LocalSupervisorDependencies["inspectWorkspace"],
    doctorHermes: vi.fn(async () => {
      calls.push("hermes");
      return {
        ok: true,
        projectRoot,
        hermesAvailable: true,
        hermesVersion: "1.0.0",
        installed: true,
        artifacts: [],
        mcp: { ok: true, toolCount: 1, missingTools: [], missingResources: [], workspaceOk: true, catalogOk: true },
        compatibility: { ok: true, expectedVersion: "test", upgradeRequired: false, reasons: [], upgradeCommand: "loopgraph setup" },
        activation: { receiptPath: path.join(projectRoot, ".loopgraph", "hermes", "activation.json"), applied: true, current: true },
        warnings: []
      };
    }) as unknown as LocalSupervisorDependencies["doctorHermes"],
    syncRoutes: vi.fn(async () => {
      calls.push("routes:sync");
      return routeSyncResult(projectRoot);
    }) as unknown as LocalSupervisorDependencies["syncRoutes"],
    doctorRoutes: vi.fn(async () => {
      calls.push("routes:doctor");
      return routeDoctorResult(projectRoot);
    }) as unknown as LocalSupervisorDependencies["doctorRoutes"],
    reconcileConnections: vi.fn(async () => {
      calls.push("connections");
      return {
        report: {
          schemaVersion: "connection-reconciliation/v1alpha1",
          id: "reconciliation_test",
          projectRootId: "project_test",
          status: "healthy",
          connectionPlanHash: "plan",
          metricBindingsHash: "bindings",
          webhookCatalogVersion: "catalog",
          webhookManifestOk: true,
          checkedConnectionIds: [],
          checkedBindingIds: [],
          issues: [],
          checkedAt: "2026-08-17T13:00:00.000Z"
        },
        controllerTrigger: undefined
      };
    }) as unknown as LocalSupervisorDependencies["reconcileConnections"],
    scheduleMeasurements: vi.fn(async () => {
      calls.push("measurements");
      return {
        schemaVersion: "measurement-scheduler/v1alpha1",
        scheduledAt: "2026-08-17T13:00:00.000Z",
        created: [],
        existing: [],
        blockedBindings: []
      };
    }) as LocalSupervisorDependencies["scheduleMeasurements"],
    runRouteWorker: vi.fn(async () => {
      calls.push("worker");
      return {
        schemaVersion: "route-job-worker/v1alpha1",
        workerId: "worker",
        claimed: 0,
        processed: 0,
        completed: 0,
        dispatched: 0,
        waitingReview: 0,
        failed: 0,
        deadLetter: 0,
        reconciledReviews: 0,
        items: []
      };
    }) as LocalSupervisorDependencies["runRouteWorker"],
    scanOpportunities: vi.fn(async () => {
      calls.push("opportunities");
      return {
        schemaVersion: "loop-opportunity-scan/v1alpha1",
        scannedAt: "2026-08-17T13:00:00.000Z",
        signalCount: 0,
        opportunities: [],
        graphChangeSets: [],
        designDispatches: []
      };
    }) as LocalSupervisorDependencies["scanOpportunities"],
    callAppTool: vi.fn(async (name, input) => {
      if (name === "loopgraph_app_install_status") {
        calls.push("apps:status");
        return { installations: [{ id: "install_sales" }] };
      }
      if (name === "loopgraph_apps_renewal_plan") {
        calls.push("apps:renewal-plan");
        return fleetRenewalPlan("current");
      }
      calls.push(`apps:diff:${String((input as { installationId?: string }).installationId)}`);
      return { updateAvailable: { version: "1.1.0", artifactDigest: "sha256:update" } };
    }) as LocalSupervisorDependencies["callAppTool"],
    runController: vi.fn(async () => {
      calls.push("controller");
      return {
        schemaVersion: "loop-controller-scheduler/v1alpha1",
        claimed: 0,
        completed: 0,
        failed: 0,
        items: []
      };
    }) as LocalSupervisorDependencies["runController"]
  };
}

function fleetRenewalPlan(status: "invalid" | "expired" | "renew_soon" | "incomplete" | "current") {
  const counts = {
    notApplicable: 0,
    incomplete: status === "incomplete" ? 1 : 0,
    current: status === "current" ? 1 : 0,
    renewSoon: status === "renew_soon" ? 1 : 0,
    expired: status === "expired" ? 1 : 0,
    invalid: status === "invalid" ? 1 : 0
  };
  const nextAction = status === "invalid"
    ? { kind: "repair_evidence", summary: "Replace the invalid evidence references." }
    : status === "expired" || status === "renew_soon"
      ? { kind: "renew_proof", summary: "Run a bounded write-blocked replay and record current observed evidence." }
      : status === "incomplete"
        ? { kind: "complete_setup", summary: "Complete the remaining evidence-derived maturity gate." }
        : { kind: "monitor", summary: "Monitor routing quality, review burden, outcomes, and value." };
  const affectedEvidence = status === "current" || status === "incomplete"
    ? []
    : [{
        id: "historical_replay",
        status: status === "renew_soon" ? "renew_soon" : status === "expired" ? "expired" : "invalid",
        summary: "Historical replay proof requires attention."
      }];
  return {
    schemaVersion: "loopgraph-app-evidence-renewal-plan/v1alpha1",
    workspaceId: "workspace",
    companyId: "company",
    generatedAt: "2026-08-17T13:00:00.000Z",
    totalInstallations: 1,
    totalMatched: 1,
    counts,
    items: [{
      installationId: "install_sales",
      appId: "qualify-route-inbound-leads",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      maturity: status === "current" ? "production_proven" : "connected",
      status,
      priority: status === "invalid" || status === "expired"
        ? "critical"
        : status === "renew_soon"
          ? "high"
          : status === "incomplete"
            ? "medium"
            : "none",
      ...(status === "renew_soon" || status === "current" ? { validUntil: "2026-08-24T13:00:00.000Z" } : {}),
      affectedEvidence,
      nextAction
    }]
  };
}

function hermesSetupResult(projectRoot: string) {
  return {
    ok: true,
    localReady: true,
    hermesReady: true,
    projectRoot,
    install: { firstPrompt: "Start" },
    doctor: {
      ok: true,
      activation: {
        receiptPath: path.join(projectRoot, ".loopgraph", "hermes", "activation.json"),
        applied: false,
        current: false
      }
    },
    hermesConfig: {
      generatedSnippetPath: path.join(projectRoot, ".loopgraph", "hermes", "mcp.loopgraph.yaml"),
      targetConfigPath: "~/.hermes/config.yaml" as const,
      skillsDir: path.join(projectRoot, ".loopgraph", "hermes", "skills")
    },
    commandUsage: {
      fromClone: {},
      fromInstalledPackage: {},
      firstHermesPrompt: "Start"
    },
    nextSteps: [],
    safety: [],
    warnings: []
  } as unknown as Awaited<ReturnType<LocalSupervisorDependencies["setupHermes"]>>;
}

function routeSyncResult(projectRoot: string) {
  return {
    projectRoot,
    manifestPath: path.join(projectRoot, ".loopgraph", "hermes-routes.json"),
    summary: {
      syncedRouteCount: 2,
      addedRouteNames: [],
      updatedRouteNames: [],
      removedRouteNames: [],
      preservedExternalRouteCount: 0
    }
  };
}

function routeDoctorResult(projectRoot: string) {
  return {
    projectRoot,
    ok: true,
    warnings: []
  };
}

function studioPlan(projectRoot: string) {
  return {
    schemaVersion: "loopgraph-studio/v1alpha1" as const,
    projectRoot,
    workspaceRoot: path.join(projectRoot, ".loopgraph"),
    url: "http://localhost:3000/brain",
    canStart: false,
    nextActions: []
  };
}
