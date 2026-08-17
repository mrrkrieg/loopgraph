import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { callLoopgraphAppTool } from "./app-tools";
import { doctorHermesIntegration, setupHermesIntegration, type HermesInstallScope } from "./hermes-install";
import { doctorHermesWebhookRoutes, syncHermesWebhookRoutes } from "./hermes-webhooks";
import { runLoopControllerScheduler } from "./loop-controller-scheduler";
import { scanLoopOpportunities } from "./loop-opportunity-engine";
import { reconcileConnectionsAndMeasurements, scheduleDueMeasurements } from "./measurement-service";
import { runRouteJobWorker } from "./route-job-worker";
import { redactSensitiveString } from "./secret-redaction";
import { getLoopgraphRoot } from "./storage-resolver";
import { prepareLoopgraphStudio, type LoopgraphStudioPlan } from "./studio";
import { initLoopgraphWorkspace, inspectLoopgraphWorkspace } from "./workspace";

export const LOOPGRAPH_LOCAL_SETUP_SCHEMA_VERSION = "loopgraph-local-setup/v1alpha1" as const;
export const LOOPGRAPH_LOCAL_SUPERVISOR_SCHEMA_VERSION = "loopgraph-local-supervisor/v1alpha1" as const;

export const LOCAL_SUPERVISOR_COMPONENTS = [
  "workspace",
  "hermes",
  "routes",
  "connections",
  "measurements",
  "route_worker",
  "opportunities",
  "app_updates",
  "controller"
] as const;

export type LocalSupervisorComponentName = (typeof LOCAL_SUPERVISOR_COMPONENTS)[number];
export type LocalSupervisorHealth = "healthy" | "degraded" | "blocked";

const componentStatusSchema = z.object({
  name: z.enum(LOCAL_SUPERVISOR_COMPONENTS),
  health: z.enum(["healthy", "degraded", "blocked"]),
  checkedAt: z.string().datetime(),
  summary: z.string().min(1),
  details: z.record(z.unknown()).default({}),
  error: z.string().min(1).optional()
});

const localSupervisorStatusSchema = z.object({
  schemaVersion: z.literal(LOOPGRAPH_LOCAL_SUPERVISOR_SCHEMA_VERSION),
  projectRoot: z.string().min(1),
  workspaceRoot: z.string().min(1),
  supervisorId: z.string().min(1),
  cycle: z.number().int().positive(),
  health: z.enum(["healthy", "degraded", "blocked"]),
  startedAt: z.string().datetime(),
  checkedAt: z.string().datetime(),
  components: z.array(componentStatusSchema),
  recommendedActions: z.array(z.string().min(1)),
  statusPath: z.string().min(1)
});

const localSupervisorLockSchema = z.object({
  schemaVersion: z.literal("loopgraph-local-supervisor-lock/v1alpha1"),
  supervisorId: z.string().min(1),
  token: z.string().uuid(),
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  startedAt: z.string().datetime()
});

export type LocalSupervisorComponentStatus = z.infer<typeof componentStatusSchema>;
export type LocalSupervisorStatus = z.infer<typeof localSupervisorStatusSchema>;

export type LocalSupervisorCadence = Record<LocalSupervisorComponentName, number>;

export const DEFAULT_LOCAL_SUPERVISOR_CADENCE_SECONDS: LocalSupervisorCadence = {
  workspace: 300,
  hermes: 300,
  routes: 300,
  connections: 3600,
  measurements: 60,
  route_worker: 5,
  opportunities: 900,
  app_updates: 3600,
  controller: 5
};

export type PrepareLocalLoopgraphInput = {
  projectRoot?: string;
  displayName?: string;
  scope?: HermesInstallScope;
  activateHermes?: boolean;
  cliEntryPath?: string;
  nodeCommand?: string;
  host?: string;
  port?: number | string;
  searchRoots?: string[];
  now?: Date;
};

export type LocalLoopgraphSetupResult = {
  schemaVersion: typeof LOOPGRAPH_LOCAL_SETUP_SCHEMA_VERSION;
  projectRoot: string;
  workspaceRoot: string;
  readyToStart: boolean;
  readyForHermes: boolean;
  workspace: {
    registeredSpecCount: number;
    demoCatalogEnabled: boolean;
  };
  hermes: Awaited<ReturnType<typeof setupHermesIntegration>>;
  routes: {
    syncedRouteCount: number;
    manifestPath: string;
    ok: boolean;
    warnings: string[];
  };
  studio: LoopgraphStudioPlan;
  nextActions: string[];
  warnings: string[];
};

export type LocalSupervisorCycleInput = {
  projectRoot?: string;
  supervisorId?: string;
  cycle?: number;
  startedAt?: string;
  components?: LocalSupervisorComponentName[];
  previousStatus?: LocalSupervisorStatus;
  workerLimit?: number;
  controllerLimit?: number;
  now?: Date;
};

export type RunLocalSupervisorInput = {
  projectRoot?: string;
  supervisorId?: string;
  once?: boolean;
  intervalSeconds?: number;
  cadenceSeconds?: Partial<LocalSupervisorCadence>;
  workerLimit?: number;
  controllerLimit?: number;
  signal?: AbortSignal;
  now?: () => Date;
};

export type LocalSupervisorDependencies = {
  initWorkspace: typeof initLoopgraphWorkspace;
  inspectWorkspace: typeof inspectLoopgraphWorkspace;
  setupHermes: typeof setupHermesIntegration;
  doctorHermes: typeof doctorHermesIntegration;
  syncRoutes: typeof syncHermesWebhookRoutes;
  doctorRoutes: typeof doctorHermesWebhookRoutes;
  reconcileConnections: typeof reconcileConnectionsAndMeasurements;
  scheduleMeasurements: typeof scheduleDueMeasurements;
  runRouteWorker: typeof runRouteJobWorker;
  scanOpportunities: typeof scanLoopOpportunities;
  runController: typeof runLoopControllerScheduler;
  callAppTool: typeof callLoopgraphAppTool;
  prepareStudio: typeof prepareLoopgraphStudio;
};

const DEFAULT_DEPENDENCIES: LocalSupervisorDependencies = {
  initWorkspace: initLoopgraphWorkspace,
  inspectWorkspace: inspectLoopgraphWorkspace,
  setupHermes: setupHermesIntegration,
  doctorHermes: doctorHermesIntegration,
  syncRoutes: syncHermesWebhookRoutes,
  doctorRoutes: doctorHermesWebhookRoutes,
  reconcileConnections: reconcileConnectionsAndMeasurements,
  scheduleMeasurements: scheduleDueMeasurements,
  runRouteWorker: runRouteJobWorker,
  scanOpportunities: scanLoopOpportunities,
  runController: runLoopControllerScheduler,
  callAppTool: callLoopgraphAppTool,
  prepareStudio: prepareLoopgraphStudio
};

export async function prepareLocalLoopgraph(
  input: PrepareLocalLoopgraphInput = {},
  dependencies: Partial<LocalSupervisorDependencies> = {}
): Promise<LocalLoopgraphSetupResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const now = input.now ?? new Date();
  await deps.initWorkspace({
    projectRoot,
    displayName: input.displayName,
    demoCatalogEnabled: false,
    createdBy: "cli",
    now
  });
  const hermes = await deps.setupHermes({
    projectRoot,
    scope: input.scope ?? "project",
    activate: input.activateHermes ?? false,
    cliEntryPath: input.cliEntryPath,
    nodeCommand: input.nodeCommand,
    now
  });
  const routeSync = await deps.syncRoutes({ projectRoot, now });
  const routeDoctor = await deps.doctorRoutes({ projectRoot, now });
  const [workspace, studio] = await Promise.all([
    deps.inspectWorkspace({ projectRoot }),
    deps.prepareStudio({
      projectRoot,
      host: input.host,
      port: input.port,
      searchRoots: input.searchRoots,
      now
    })
  ]);
  const warnings = uniqueStrings([
    ...hermes.warnings,
    ...routeDoctor.warnings,
    ...(studio.canStart ? [] : ["The local Studio UI is not bundled with this package installation; the supervisor can still run headlessly."])
  ]);
  const readyToStart = hermes.localReady && routeDoctor.ok;
  const nextActions = uniqueStrings([
    ...(input.activateHermes
      ? []
      : ["Activate the generated Hermes integration with `loopgraph setup --activate` when you are ready to update Hermes configuration."]),
    ...(hermes.hermesReady
      ? [`Open Hermes and say: ${hermes.commandUsage.firstHermesPrompt}`]
      : ["Install Hermes Agent and confirm `hermes --version` succeeds."]),
    "Run `loopgraph start` to start the local supervisor and Studio UI.",
    ...(workspace.registeredSpecCount === 0
      ? ["The workspace is intentionally empty. Use Hermes to discover or install the first app; no preview loops were copied locally."]
      : [])
  ]);

  return {
    schemaVersion: LOOPGRAPH_LOCAL_SETUP_SCHEMA_VERSION,
    projectRoot,
    workspaceRoot: workspace.workspaceRoot,
    readyToStart,
    readyForHermes: hermes.hermesReady && Boolean(hermes.activation?.applied || hermes.doctor.activation.current),
    workspace: {
      registeredSpecCount: workspace.registeredSpecCount,
      demoCatalogEnabled: workspace.registry.demoCatalogEnabled
    },
    hermes,
    routes: {
      syncedRouteCount: routeSync.summary.syncedRouteCount,
      manifestPath: routeSync.manifestPath,
      ok: routeDoctor.ok,
      warnings: routeDoctor.warnings
    },
    studio,
    nextActions,
    warnings
  };
}

export async function runLocalSupervisorCycle(
  input: LocalSupervisorCycleInput = {},
  dependencies: Partial<LocalSupervisorDependencies> = {}
): Promise<LocalSupervisorStatus> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const workspaceRoot = getLoopgraphRoot(projectRoot);
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const supervisorId = input.supervisorId ?? `local_${process.pid}`;
  const selected = new Set(input.components ?? LOCAL_SUPERVISOR_COMPONENTS);
  const previousByName = new Map(input.previousStatus?.components.map((component) => [component.name, component]));
  const components: LocalSupervisorComponentStatus[] = [];

  const run = async (
    name: LocalSupervisorComponentName,
    failureHealth: LocalSupervisorHealth,
    operation: () => Promise<LocalSupervisorComponentStatus>
  ) => {
    if (!selected.has(name)) {
      const previous = previousByName.get(name);
      if (previous) components.push(previous);
      return;
    }
    try {
      components.push(componentStatusSchema.parse(await operation()));
    } catch (error) {
      const message = redactSensitiveString(error instanceof Error ? error.message : String(error));
      components.push({
        name,
        health: failureHealth,
        checkedAt,
        summary: `${humanizeComponent(name)} check failed.`,
        details: {},
        error: message
      });
    }
  };

  await run("workspace", "blocked", async () => {
    await deps.initWorkspace({ projectRoot, demoCatalogEnabled: false, createdBy: "cli", now });
    const workspace = await deps.inspectWorkspace({ projectRoot });
    return {
      name: "workspace",
      health: "healthy",
      checkedAt,
      summary: workspace.registeredSpecCount === 0
        ? "Local workspace is ready and intentionally contains no preview loops."
        : `${workspace.registeredSpecCount} registered loop${workspace.registeredSpecCount === 1 ? "" : "s"} are available.`,
      details: {
        registeredSpecCount: workspace.registeredSpecCount,
        routingReadySpecCount: workspace.routingReadySpecCount,
        departmentCount: workspace.registeredDepartments.length,
        demoCatalogEnabled: workspace.registry.demoCatalogEnabled
      }
    };
  });

  await run("hermes", "blocked", async () => {
    const doctor = await deps.doctorHermes({ projectRoot });
    const health: LocalSupervisorHealth = !doctor.ok
      ? "blocked"
      : doctor.hermesAvailable && doctor.activation.current
        ? "healthy"
        : "degraded";
    return {
      name: "hermes",
      health,
      checkedAt,
      summary: !doctor.ok
        ? "Project-local Hermes integration is incomplete."
        : doctor.hermesAvailable && doctor.activation.current
          ? "Hermes and the project-local MCP contract are ready."
          : !doctor.hermesAvailable
            ? "Loopgraph is ready, but the Hermes CLI is not available on PATH."
            : "The project-local Hermes contract is prepared but has not been activated at its current digest.",
      details: {
        installed: doctor.installed,
        hermesAvailable: doctor.hermesAvailable,
        mcpOk: doctor.mcp.ok,
        compatibilityOk: doctor.compatibility.ok,
        activationCurrent: doctor.activation.current,
        warningCount: doctor.warnings.length
      }
    };
  });

  await run("routes", "blocked", async () => {
    const synced = await deps.syncRoutes({ projectRoot, now });
    const doctor = await deps.doctorRoutes({ projectRoot, now });
    return {
      name: "routes",
      health: doctor.ok ? "healthy" : "blocked",
      checkedAt,
      summary: doctor.ok
        ? `${synced.summary.syncedRouteCount} Hermes route${synced.summary.syncedRouteCount === 1 ? " is" : "s are"} synchronized.`
        : "Hermes routes do not match the active routing catalog.",
      details: {
        routeCount: synced.summary.syncedRouteCount,
        added: synced.summary.addedRouteNames.length,
        updated: synced.summary.updatedRouteNames.length,
        removed: synced.summary.removedRouteNames.length,
        preservedExternal: synced.summary.preservedExternalRouteCount,
        warningCount: doctor.warnings.length
      }
    };
  });

  await run("connections", "degraded", async () => {
    const result = await deps.reconcileConnections({ projectRoot, now });
    return {
      name: "connections",
      health: result.report.status,
      checkedAt,
      summary: result.report.issues.length === 0
        ? "Configured connections and metric bindings are healthy."
        : `${result.report.issues.length} connection or evidence issue${result.report.issues.length === 1 ? "" : "s"} require attention.`,
      details: {
        checkedConnections: result.report.checkedConnectionIds.length,
        checkedBindings: result.report.checkedBindingIds.length,
        blockingIssues: result.report.issues.filter((issue) => issue.severity === "blocking").length,
        warningIssues: result.report.issues.filter((issue) => issue.severity === "warning").length
      }
    };
  });

  await run("measurements", "degraded", async () => {
    const result = await deps.scheduleMeasurements({ projectRoot, now });
    return {
      name: "measurements",
      health: result.blockedBindings.length > 0 ? "blocked" : "healthy",
      checkedAt,
      summary: result.blockedBindings.length > 0
        ? `${result.blockedBindings.length} measurement binding${result.blockedBindings.length === 1 ? " is" : "s are"} blocked.`
        : `${result.created.length} due measurement job${result.created.length === 1 ? " was" : "s were"} scheduled.`,
      details: {
        created: result.created.length,
        existing: result.existing.length,
        blockedBindings: result.blockedBindings.length
      }
    };
  });

  await run("route_worker", "blocked", async () => {
    const result = await deps.runRouteWorker({
      projectRoot,
      workerId: `${supervisorId}:route-worker`,
      limit: input.workerLimit ?? 20,
      now
    });
    const health: LocalSupervisorHealth = result.deadLetter > 0
      ? "blocked"
      : result.failed > 0
        ? "degraded"
        : "healthy";
    return {
      name: "route_worker",
      health,
      checkedAt,
      summary: result.processed === 0
        ? "No due Hermes route jobs."
        : `${result.completed + result.dispatched} of ${result.processed} route jobs completed or dispatched.`,
      details: {
        claimed: result.claimed,
        processed: result.processed,
        completed: result.completed,
        dispatched: result.dispatched,
        waitingReview: result.waitingReview,
        failed: result.failed,
        deadLetter: result.deadLetter,
        reconciledReviews: result.reconciledReviews
      }
    };
  });

  await run("opportunities", "degraded", async () => {
    const result = await deps.scanOpportunities({ projectRoot, autoStartDesign: false, now });
    return {
      name: "opportunities",
      health: "healthy",
      checkedAt,
      summary: result.opportunities.length === 0
        ? "No new loop opportunities were detected."
        : `${result.opportunities.length} loop opportunit${result.opportunities.length === 1 ? "y was" : "ies were"} detected for review.`,
      details: {
        signals: result.signalCount,
        opportunities: result.opportunities.length,
        graphChangeSets: result.graphChangeSets.length,
        designDispatches: result.designDispatches.length
      }
    };
  });

  await run("app_updates", "degraded", async () => {
    const status = await deps.callAppTool("loopgraph_app_install_status", { projectRoot }) as unknown;
    const installations = readInstallations(status);
    const diffs = await Promise.all(installations.map(async (installationId) =>
      deps.callAppTool("loopgraph_app_diff", { projectRoot, installationId }) as Promise<unknown>
    ));
    const updates = diffs.filter(hasUpdateAvailable).length;
    return {
      name: "app_updates",
      health: "healthy",
      checkedAt,
      summary: updates > 0
        ? `${updates} installed app update${updates === 1 ? " is" : "s are"} available for review.`
        : `${installations.length} installed app${installations.length === 1 ? " is" : "s are"} current.`,
      details: {
        installedApps: installations.length,
        updatesAvailable: updates
      }
    };
  });

  await run("controller", "blocked", async () => {
    const result = await deps.runController({ projectRoot, limit: input.controllerLimit ?? 20, now });
    return {
      name: "controller",
      health: result.failed > 0 ? "degraded" : "healthy",
      checkedAt,
      summary: result.claimed === 0
        ? "No due Hermes Brain controller triggers."
        : `${result.completed} of ${result.claimed} controller trigger${result.claimed === 1 ? "" : "s"} completed.`,
      details: {
        claimed: result.claimed,
        completed: result.completed,
        failed: result.failed
      }
    };
  });

  const orderedComponents = LOCAL_SUPERVISOR_COMPONENTS.flatMap((name) => {
    const component = components.find((candidate) => candidate.name === name);
    return component ? [component] : [];
  });
  const health = aggregateHealth(orderedComponents);
  const statusPath = localSupervisorStatusPath(projectRoot);
  const status = localSupervisorStatusSchema.parse({
    schemaVersion: LOOPGRAPH_LOCAL_SUPERVISOR_SCHEMA_VERSION,
    projectRoot,
    workspaceRoot,
    supervisorId,
    cycle: input.cycle ?? 1,
    health,
    startedAt: input.startedAt ?? checkedAt,
    checkedAt,
    components: orderedComponents,
    recommendedActions: recommendedActionsFor(orderedComponents),
    statusPath
  });
  await writeLocalSupervisorStatus(status);
  return status;
}

export async function runLocalLoopgraphSupervisor(
  input: RunLocalSupervisorInput = {},
  dependencies: Partial<LocalSupervisorDependencies> & {
    onCycle?: (status: LocalSupervisorStatus) => void | Promise<void>;
  } = {}
): Promise<LocalSupervisorStatus> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const supervisorId = input.supervisorId ?? `local_${process.pid}`;
  const intervalSeconds = boundedInteger(input.intervalSeconds ?? 5, 1, 3600, "Supervisor interval seconds");
  const cadence = normalizeCadence(input.cadenceSeconds);
  const startedAt = (input.now?.() ?? new Date()).toISOString();
  const lease = await acquireLocalSupervisorLease(projectRoot, supervisorId, new Date(startedAt));
  let status = await readLocalSupervisorStatus(projectRoot);
  if (status?.supervisorId !== supervisorId) status = undefined;
  let cycle = status?.cycle ?? 0;

  try {
    do {
      const now = input.now?.() ?? new Date();
      const components = componentsDue(status, now, cadence);
      cycle += 1;
      status = await runLocalSupervisorCycle({
        projectRoot,
        supervisorId,
        cycle,
        startedAt,
        components,
        previousStatus: status,
        workerLimit: input.workerLimit,
        controllerLimit: input.controllerLimit,
        now
      }, dependencies);
      await dependencies.onCycle?.(status);
      if (input.once || input.signal?.aborted) break;
      await waitForNextCycle(intervalSeconds * 1000, input.signal);
    } while (!input.signal?.aborted);
    return status;
  } finally {
    await releaseLocalSupervisorLease(projectRoot, lease);
  }
}

export async function readLocalSupervisorStatus(projectRoot = process.cwd()): Promise<LocalSupervisorStatus | undefined> {
  try {
    return localSupervisorStatusSchema.parse(JSON.parse(await readFile(localSupervisorStatusPath(projectRoot), "utf8")));
  } catch {
    return undefined;
  }
}

export async function inspectLocalSupervisorRuntime(projectRoot = process.cwd()): Promise<{
  running: boolean;
  status?: LocalSupervisorStatus;
}> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const [status, lock] = await Promise.all([
    readLocalSupervisorStatus(resolvedProjectRoot),
    readLocalSupervisorLock(localSupervisorLockPath(resolvedProjectRoot))
  ]);
  return {
    running: Boolean(lock && (lock.hostname !== os.hostname() || processIsAlive(lock.pid))),
    ...(status ? { status } : {})
  };
}

export function localSupervisorStatusPath(projectRoot = process.cwd()): string {
  return path.join(getLoopgraphRoot(path.resolve(projectRoot)), "supervisor", "status.json");
}

export function localSupervisorLockPath(projectRoot = process.cwd()): string {
  return path.join(getLoopgraphRoot(path.resolve(projectRoot)), "supervisor", "lock.json");
}

function componentsDue(
  previous: LocalSupervisorStatus | undefined,
  now: Date,
  cadence: LocalSupervisorCadence
): LocalSupervisorComponentName[] {
  if (!previous) return [...LOCAL_SUPERVISOR_COMPONENTS];
  const previousByName = new Map(previous.components.map((component) => [component.name, component]));
  return LOCAL_SUPERVISOR_COMPONENTS.filter((name) => {
    const component = previousByName.get(name);
    if (!component) return true;
    return Date.parse(component.checkedAt) + cadence[name] * 1000 <= now.getTime();
  });
}

function normalizeCadence(input: Partial<LocalSupervisorCadence> | undefined): LocalSupervisorCadence {
  return Object.fromEntries(LOCAL_SUPERVISOR_COMPONENTS.map((name) => [
    name,
    boundedInteger(input?.[name] ?? DEFAULT_LOCAL_SUPERVISOR_CADENCE_SECONDS[name], 1, 86_400, `${humanizeComponent(name)} cadence seconds`)
  ])) as LocalSupervisorCadence;
}

function aggregateHealth(components: LocalSupervisorComponentStatus[]): LocalSupervisorHealth {
  if (components.some((component) => component.health === "blocked")) return "blocked";
  if (components.some((component) => component.health === "degraded")) return "degraded";
  return "healthy";
}

function recommendedActionsFor(components: LocalSupervisorComponentStatus[]): string[] {
  const byName = new Map(components.map((component) => [component.name, component]));
  const actions: string[] = [];
  if (byName.get("workspace")?.details.registeredSpecCount === 0) {
    actions.push("Open Hermes and say `Start` to choose a department and create or install the first app.");
  }
  if (byName.get("hermes")?.health !== "healthy") {
    actions.push("Run `loopgraph setup --activate`, then rerun `loopgraph start`.");
  }
  if (byName.get("routes")?.health !== "healthy") {
    actions.push("Inspect the route plan with `loopgraph hermes webhooks doctor --project .`.");
  }
  const connectionBlocking = Number(byName.get("connections")?.details.blockingIssues ?? 0);
  if (connectionBlocking > 0) {
    actions.push("Ask Hermes to repair the blocked provider connection or mapping before promoting affected loops.");
  }
  const measurementBlocking = Number(byName.get("measurements")?.details.blockedBindings ?? 0);
  if (measurementBlocking > 0) {
    actions.push("Connect the required read capability or configure a manual measurement fallback.");
  }
  const appUpdates = Number(byName.get("app_updates")?.details.updatesAvailable ?? 0);
  if (appUpdates > 0) {
    actions.push("Review app graph, permission, and configuration changes before applying an update.");
  }
  for (const component of components.filter((item) => item.error)) {
    actions.push(`Inspect ${humanizeComponent(component.name).toLowerCase()} health; its last check failed without stopping unrelated services.`);
  }
  return uniqueStrings(actions);
}

async function writeLocalSupervisorStatus(status: LocalSupervisorStatus): Promise<void> {
  const target = status.statusPath;
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function acquireLocalSupervisorLease(projectRoot: string, supervisorId: string, now: Date) {
  const lockPath = localSupervisorLockPath(projectRoot);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = localSupervisorLockSchema.parse({
    schemaVersion: "loopgraph-local-supervisor-lock/v1alpha1",
    supervisorId,
    token: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now.toISOString()
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
      } finally {
        await handle.close();
      }
      return lock;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await readLocalSupervisorLock(lockPath);
      if (existing && (existing.hostname !== os.hostname() || processIsAlive(existing.pid))) {
        const owner = existing.hostname === os.hostname()
          ? `PID ${existing.pid}`
          : `host ${existing.hostname} (PID ${existing.pid})`;
        throw new Error(`Loopgraph supervisor ${existing.supervisorId} is already running on ${owner}.`);
      }
      if (attempt === 1) throw new Error("Could not acquire the Loopgraph supervisor lock after removing a stale owner.");
      await unlink(lockPath).catch((unlinkError) => {
        if (!isMissing(unlinkError)) throw unlinkError;
      });
    }
  }
  throw new Error("Could not acquire the Loopgraph supervisor lock.");
}

async function releaseLocalSupervisorLease(
  projectRoot: string,
  lease: z.infer<typeof localSupervisorLockSchema>
): Promise<void> {
  const lockPath = localSupervisorLockPath(projectRoot);
  const existing = await readLocalSupervisorLock(lockPath);
  if (!existing || existing.token !== lease.token) return;
  await unlink(lockPath).catch((error) => {
    if (!isMissing(error)) throw error;
  });
}

async function readLocalSupervisorLock(lockPath: string) {
  try {
    return localSupervisorLockSchema.parse(JSON.parse(await readFile(lockPath, "utf8")));
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionDenied(error);
  }
}

async function waitForNextCycle(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => done();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function readInstallations(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.installations)) return [];
  return value.installations.flatMap((installation) =>
    isRecord(installation) && typeof installation.id === "string" ? [installation.id] : []
  );
}

function hasUpdateAvailable(value: unknown): boolean {
  return isRecord(value) && isRecord(value.updateAvailable);
}

function humanizeComponent(name: LocalSupervisorComponentName): string {
  return name.replace(/_/g, " ").replace(/^./, (value) => value.toUpperCase());
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isPermissionDenied(error: unknown): boolean {
  return isNodeError(error) && error.code === "EPERM";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
