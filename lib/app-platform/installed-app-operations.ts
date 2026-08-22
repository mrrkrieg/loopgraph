import type { AppEvalRun, AppOperationAction } from "loopgraph/core";
import type { AgentOperationsActivityRow } from "loopgraph/runtime";
import type {
  LoopGraphVisual,
  LoopGraphVisualEdge,
  LoopGraphVisualNode
} from "@/lib/loop-engineering-builder/loop-graph-visualization";
import type { OutcomeView, ValueEntryView } from "@/lib/loopgraph-runtime/operating-view-data";

export type InstalledAppOperationsView = {
  activity: AgentOperationsActivityRow[];
  actions: Array<AppOperationAction & { effectiveStatus: "prepared" | "expired" }>;
  outcomes: OutcomeView[];
  valueEntries: ValueEntryView[];
  topology: LoopGraphVisual;
  summary: {
    incomingEvents: number;
    totalRuns: number;
    activeRuns: number;
    waitingApproval: number;
    preparedActions: number;
    actionsAwaitingApproval: number;
    expiredActions: number;
    completedRuns: number;
    failedRuns: number;
    observedOutcomes: number;
    reviewedDecisions: number;
    correctDecisions: number;
    incompleteDecisions: number;
    falsePositiveDecisions: number;
    routingAccuracy?: number;
    reviewMinutes: number;
    observedNetMinutes: number;
    observedCostMinutes: number;
    lastActivityAt?: string;
  };
};

export function buildInstalledAppOperationsView(input: {
  app: { installationId: string; id: string; name: string; department: string };
  loops: Array<{ id: string; name: string }>;
  activity: AgentOperationsActivityRow[];
  evaluations: AppEvalRun[];
  outcomes: OutcomeView[];
  valueEntries: ValueEntryView[];
  actions?: AppOperationAction[];
  now?: Date;
}): InstalledAppOperationsView {
  const loopIds = new Set(input.loops.map((loop) => loop.id));
  const activityById = new Map(input.activity
    .filter((row) => loopIds.has(row.loopId))
    .map((row) => [row.id, row]));
  const activity = [...activityById.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const outcomes = input.outcomes
    .filter((outcome) => loopIds.has(outcome.loopId))
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt));
  const valueEntries = input.valueEntries
    .filter((entry) => loopIds.has(entry.loopId))
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  const latestReplay = input.evaluations
    .filter((evaluation) => evaluation.level === "historical_replay")
    .sort((left, right) => evaluationTime(right).localeCompare(evaluationTime(left)))[0];
  const reviewedScenarios = latestReplay?.scenarios.filter((scenario) => scenario.humanLabel) ?? [];
  const correctDecisions = reviewedScenarios.filter((scenario) => scenario.humanLabel === "correct").length;
  const observedOutcomes = outcomes.filter((outcome) => outcome.truthStatus === "observed");
  const observedValue = valueEntries.filter((entry) => entry.truthStatus === "observed");
  const now = input.now ?? new Date();
  const actions = (input.actions ?? [])
    .filter((action) => action.installationId === input.app.installationId && loopIds.has(action.loopId))
    .map((action) => ({
      ...action,
      effectiveStatus: action.status === "prepared" && Date.parse(action.expiresAt) <= now.getTime()
        ? "expired" as const
        : action.status
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));

  return {
    activity,
    actions,
    outcomes,
    valueEntries,
    topology: buildInstalledAppOperationsTopology({ app: input.app, loops: input.loops, activity, actions, outcomes }),
    summary: {
      incomingEvents: new Set(activity.map((row) => row.eventId)).size,
      totalRuns: activity.length,
      activeRuns: activity.filter((row) => ["claimed", "dispatched", "running"].includes(row.jobStatus)).length,
      waitingApproval: activity.filter((row) => row.jobStatus === "waiting_review").length,
      preparedActions: actions.filter((action) => action.effectiveStatus === "prepared").length,
      actionsAwaitingApproval: actions.filter((action) => action.effectiveStatus === "prepared" && action.approvalRequired).length,
      expiredActions: actions.filter((action) => action.effectiveStatus === "expired").length,
      completedRuns: activity.filter((row) => row.jobStatus === "completed").length,
      failedRuns: activity.filter((row) => ["failed", "dead_letter"].includes(row.jobStatus)).length,
      observedOutcomes: observedOutcomes.length,
      reviewedDecisions: reviewedScenarios.length,
      correctDecisions,
      incompleteDecisions: reviewedScenarios.filter((scenario) => scenario.humanLabel === "incomplete").length,
      falsePositiveDecisions: reviewedScenarios.filter((scenario) => scenario.humanLabel === "false_positive").length,
      ...(reviewedScenarios.length > 0 ? { routingAccuracy: correctDecisions / reviewedScenarios.length } : {}),
      reviewMinutes: reviewedScenarios.reduce((total, scenario) => total + (scenario.reviewMinutes ?? 0), 0),
      observedNetMinutes: observedValue.reduce((total, entry) => total + entry.netSavedMinutes, 0),
      observedCostMinutes: observedValue.reduce((total, entry) => total + entry.observedCostMinutes, 0),
      ...(activity[0] ? { lastActivityAt: activity[0].updatedAt } : {})
    }
  };
}

export function buildInstalledAppOperationsTopology(input: {
  app: { id: string; name: string; department: string };
  loops: Array<{ id: string; name: string }>;
  activity: AgentOperationsActivityRow[];
  actions?: Array<AppOperationAction & { effectiveStatus?: "prepared" | "expired" }>;
  outcomes: OutcomeView[];
}): LoopGraphVisual {
  const nodes = new Map<string, LoopGraphVisualNode>();
  const edges = new Map<string, LoopGraphVisualEdge>();
  const brainId = "installed-app:hermes";
  nodes.set(brainId, {
    id: brainId,
    kind: "management",
    label: "Hermes Brain",
    subtitle: "Event router",
    weight: 6,
    metadata: { runtimeKind: "hermes_brain" }
  });
  const departmentNodeId = `installed-app:department:${normalizeTopologyId(input.app.department)}`;
  const appNodeId = `installed-app:app:${normalizeTopologyId(input.app.id)}`;
  nodes.set(departmentNodeId, {
    id: departmentNodeId,
    kind: "department",
    label: humanizeTopologyLabel(input.app.department),
    subtitle: "Accountable department",
    weight: 5,
    metadata: { department: input.app.department, runtimeKind: "department" }
  });
  nodes.set(appNodeId, {
    id: appNodeId,
    kind: "rollup",
    label: "Installed App",
    subtitle: input.app.name,
    department: normalizeDepartment(input.app.department),
    weight: 5,
    metadata: { appId: input.app.id, runtimeKind: "installed_app" }
  });
  addTopologyEdge(edges, brainId, departmentNodeId, "routes", "routes");
  addTopologyEdge(edges, departmentNodeId, appNodeId, "owns", "owns");

  for (const loop of [...input.loops].sort((left, right) => left.name.localeCompare(right.name))) {
    const loopNodeId = topologyLoopId(loop.id);
    nodes.set(loopNodeId, {
      id: loopNodeId,
      kind: "loop",
      label: loop.name,
      subtitle: "Installed App loop",
      department: normalizeDepartment(input.app.department),
      weight: 4,
      metadata: { loopId: loop.id, runtimeKind: "loop" }
    });
    addTopologyEdge(edges, appNodeId, loopNodeId, "contains", "contains");
  }

  const latestActivityByLoop = new Map<string, AgentOperationsActivityRow>();
  for (const row of input.activity) {
    if (!latestActivityByLoop.has(row.loopId)) latestActivityByLoop.set(row.loopId, row);
  }
  for (const row of [...latestActivityByLoop.values()].slice(0, 8)) {
    const loopNodeId = topologyLoopId(row.loopId);
    if (!nodes.has(loopNodeId)) continue;
    const sourceNodeId = `installed-app:source:${normalizeTopologyId(row.source)}`;
    nodes.set(sourceNodeId, {
      id: sourceNodeId,
      kind: "data_source",
      label: row.source,
      subtitle: row.eventType,
      weight: 2,
      metadata: { runtimeKind: "event_source" }
    });
    addTopologyEdge(edges, sourceNodeId, brainId, "event", "event");

    const runNodeId = `installed-app:run:${normalizeTopologyId(row.runId)}`;
    nodes.set(runNodeId, {
      id: runNodeId,
      kind: "action",
      label: `${row.completedTaskCount}/${row.taskCount} tasks`,
      subtitle: humanizeTopologyLabel(row.jobStatus),
      weight: 3,
      metadata: {
        loopId: row.loopId,
        runId: row.runId,
        routeJobId: row.routeJobId,
        runtimeKind: "run",
        status: row.jobStatus
      }
    });
    if (row.agentInstanceId) {
      const agentNodeId = `installed-app:agent:${normalizeTopologyId(row.agentInstanceId)}`;
      nodes.set(agentNodeId, {
        id: agentNodeId,
        kind: "owner",
        label: row.agentName ?? row.agentInstanceId,
        subtitle: "Hermes agent",
        weight: 2,
        metadata: { agentInstanceId: row.agentInstanceId, runtimeKind: "agent" }
      });
      addTopologyEdge(edges, loopNodeId, agentNodeId, "executes", "executes");
      addTopologyEdge(edges, agentNodeId, runNodeId, "work", "work");
    } else {
      addTopologyEdge(edges, loopNodeId, runNodeId, "work", "work");
    }
    if (row.approvalCount > 0 || row.jobStatus === "waiting_review") {
      const reviewNodeId = `installed-app:review:${normalizeTopologyId(row.runId)}`;
      nodes.set(reviewNodeId, {
        id: reviewNodeId,
        kind: "review",
        label: row.approvalCount > 0 ? `${row.approvalCount} approval${row.approvalCount === 1 ? "" : "s"}` : "Approval required",
        subtitle: "Human gate",
        weight: 2,
        metadata: { loopId: row.loopId, runId: row.runId, runtimeKind: "approval" }
      });
      addTopologyEdge(edges, runNodeId, reviewNodeId, "approval", "approval");
    }
  }

  for (const action of (input.actions ?? []).slice(0, 8)) {
    const loopNodeId = topologyLoopId(action.loopId);
    if (!nodes.has(loopNodeId)) continue;
    const actionNodeId = `installed-app:action:${normalizeTopologyId(action.id)}`;
    nodes.set(actionNodeId, {
      id: actionNodeId,
      kind: "action",
      label: humanizeTopologyLabel(action.providerBinding.operation),
      subtitle: humanizeTopologyLabel(action.effectiveStatus ?? action.status),
      weight: 3,
      metadata: {
        loopId: action.loopId,
        routeJobId: action.routeJobId,
        actionId: action.id,
        runtimeKind: "prepared_action",
        status: action.effectiveStatus ?? action.status
      }
    });
    addTopologyEdge(edges, loopNodeId, actionNodeId, "prepares", "prepares");
    if (action.approvalRequired && (action.effectiveStatus ?? action.status) === "prepared") {
      const reviewNodeId = `installed-app:action-review:${normalizeTopologyId(action.id)}`;
      nodes.set(reviewNodeId, {
        id: reviewNodeId,
        kind: "review",
        label: "Approval required",
        subtitle: humanizeTopologyLabel(action.riskClass),
        weight: 2,
        metadata: { actionId: action.id, runtimeKind: "action_approval" }
      });
      addTopologyEdge(edges, actionNodeId, reviewNodeId, "approval", "approval");
    }
  }

  const latestOutcomeByLoop = new Map<string, OutcomeView>();
  for (const outcome of input.outcomes) {
    if (!latestOutcomeByLoop.has(outcome.loopId)) latestOutcomeByLoop.set(outcome.loopId, outcome);
  }
  for (const outcome of [...latestOutcomeByLoop.values()].slice(0, 8)) {
    const loopNodeId = topologyLoopId(outcome.loopId);
    if (!nodes.has(loopNodeId)) continue;
    const outcomeNodeId = `installed-app:outcome:${normalizeTopologyId(outcome.id)}`;
    nodes.set(outcomeNodeId, {
      id: outcomeNodeId,
      kind: "metric",
      label: humanizeTopologyLabel(outcome.metricKey),
      subtitle: `${outcome.truthStatus} outcome`,
      weight: outcome.truthStatus === "observed" ? 3 : 2,
      metadata: { loopId: outcome.loopId, outcomeId: outcome.id, runtimeKind: "outcome", truthStatus: outcome.truthStatus }
    });
    addTopologyEdge(edges, loopNodeId, outcomeNodeId, "outcome", "measures");
    addTopologyEdge(edges, outcomeNodeId, brainId, "learning_return", "evidence");
  }

  return {
    id: "installed-app:operations",
    title: "Installed App operating topology",
    valueLabel: "Recent App-owned runtime evidence",
    selectedNodeId: brainId,
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
}

function topologyLoopId(loopId: string): string {
  return `installed-app:loop:${normalizeTopologyId(loopId)}`;
}

function addTopologyEdge(
  edges: Map<string, LoopGraphVisualEdge>,
  source: string,
  target: string,
  kind: string,
  label: string
): void {
  const id = `${source}->${target}:${kind}`;
  edges.set(id, { id, source, target, kind, label });
}

function normalizeTopologyId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function normalizeDepartment(value?: string): string | undefined {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function humanizeTopologyLabel(value: string): string {
  const label = value.replace(/[_.-]+/g, " ").trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : value;
}

function evaluationTime(evaluation: AppEvalRun): string {
  return evaluation.completedAt ?? evaluation.startedAt;
}
