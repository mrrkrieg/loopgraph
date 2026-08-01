import type { AgentOperationsFilters, AgentOperationsReadModel } from "loopgraph/runtime";
import { loadAgentOperationsReadModel } from "loopgraph/runtime";
import { isHostedPreview } from "@/lib/hosted-preview";
import {
  getActiveLoopgraphProjectRoot,
  getHermesOperationsStore,
  getLoopSpecRegistryStore,
  getRoutingStore,
  getStorageAdapter
} from "@/lib/loopgraph-runtime/storage-resolver";

export async function getAgentOperationsViewData(filters: AgentOperationsFilters = {}): Promise<{
  mode: "preview" | "local";
  data: AgentOperationsReadModel;
}> {
  if (isHostedPreview()) return { mode: "preview", data: buildAgentOperationsPreview(filters) };
  const projectRoot = getActiveLoopgraphProjectRoot();
  return {
    mode: "local",
    data: await loadAgentOperationsReadModel({
      projectRoot,
      ...filters,
      routingStore: getRoutingStore(),
      operationsStore: getHermesOperationsStore(),
      storage: getStorageAdapter(),
      loopSpecStore: getLoopSpecRegistryStore({ projectRoot })
    })
  };
}

export function buildAgentOperationsPreview(filters: AgentOperationsFilters = {}): AgentOperationsReadModel {
  const generatedAt = "2026-07-31T16:00:00.000Z";
  const activity: AgentOperationsReadModel["activity"] = [
    previewRow({ id: "product-activation", source: "Product analytics", eventType: "activation.stalled", department: "Product", loopId: "activation_recovery", loopLabel: "Activation Recovery", status: "running", agent: "hermes-router-west", agentName: "Hermes West", tasks: [4, 2], tools: 3, outputs: 1, outcomes: 0, summary: "Joined product usage with CRM account context; preparing recovery plan." }),
    previewRow({ id: "sales-stalled", source: "Salesforce", eventType: "opportunity.stalled", department: "Sales", loopId: "deal_risk_recovery", loopLabel: "Deal Risk Recovery", status: "waiting_review", agent: "hermes-router-west", agentName: "Hermes West", tasks: [5, 4], tools: 4, approvals: 1, outputs: 2, outcomes: 0, summary: "Executive outreach draft is waiting for the account owner." }),
    previewRow({ id: "support-priority", source: "Support", eventType: "ticket.priority_changed", department: "Customer success", loopId: "priority_triage", loopLabel: "Priority Triage", status: "completed", agent: "hermes-router-east", agentName: "Hermes East", tasks: [3, 3], tools: 2, outputs: 1, outcomes: 1, summary: "Ticket routed to the correct escalation owner in 41 seconds." }),
    previewRow({ id: "marketing-cac", source: "Google Ads", eventType: "campaign.performance_anomaly", department: "Marketing", loopId: "ads_efficiency", loopLabel: "Ads Efficiency", status: "dispatched", agent: "hermes-router-east", agentName: "Hermes East", tasks: [0, 0], tools: 0, outputs: 0, outcomes: 0, summary: "Hermes accepted the assignment and is collecting CRM evidence." }),
    previewRow({ id: "engineering-incident", source: "Incident tracker", eventType: "incident.regression_detected", department: "Engineering", loopId: "incident_learning", loopLabel: "Incident Learning", status: "completed", agent: "hermes-secure", agentName: "Hermes Secure", tasks: [6, 6], tools: 5, outputs: 2, outcomes: 2, summary: "Regression evidence linked to the release and returned to the company brain." }),
    previewRow({ id: "finance-renewal", source: "Billing", eventType: "subscription.renewal_risk", department: "Operations & finance", loopId: "renewal_risk", loopLabel: "Renewal Risk", status: "failed", agent: "hermes-secure", agentName: "Hermes Secure", tasks: [3, 1], tools: 2, outputs: 0, outcomes: 0, summary: "ERP access expired; no financial write was attempted." })
  ].filter((row) => !filters.source || normalize(row.source).includes(normalize(filters.source)))
    .filter((row) => !filters.department || normalize(row.department) === normalize(filters.department))
    .filter((row) => !filters.loopId || row.loopId === filters.loopId)
    .filter((row) => !filters.agentInstanceId || row.agentInstanceId === filters.agentInstanceId)
    .filter((row) => !filters.status || row.jobStatus === filters.status)
    .filter((row) => filters.needsAttention !== true || row.needsAttention);
  const agents: AgentOperationsReadModel["agents"] = [
    previewAgent("hermes-router-west", "Hermes West", "production", ["crm.read", "analytics.read", "messaging.notify"]),
    previewAgent("hermes-router-east", "Hermes East", "production", ["support.read", "ads.read", "content_repository.read"]),
    previewAgent("hermes-secure", "Hermes Secure", "production", ["repository.read", "incident.read", "billing.read"])
  ];
  return {
    schemaVersion: "agent-operations/v1alpha1",
    projectRoot: "/preview/acme",
    generatedAt,
    filters,
    summary: {
      registeredAgents: agents.length,
      healthyAgents: 3,
      incomingEvents: 128,
      dispatchedRuns: activity.filter((row) => row.jobStatus === "dispatched").length,
      activeRuns: activity.filter((row) => ["running", "dispatched"].includes(row.jobStatus)).length,
      waitingApproval: activity.filter((row) => row.jobStatus === "waiting_review").length,
      completedRuns: 84,
      failedRuns: 2,
      observedOutcomes: activity.reduce((sum, row) => sum + row.observedOutcomeCount, 0)
    },
    agents,
    activity,
    topology: { nodes: [], edges: [] }
  };
}

function previewRow(input: {
  id: string;
  source: string;
  eventType: string;
  department: string;
  loopId: string;
  loopLabel: string;
  status: AgentOperationsReadModel["activity"][number]["jobStatus"];
  agent: string;
  agentName: string;
  tasks: [number, number];
  tools: number;
  approvals?: number;
  outputs: number;
  outcomes: number;
  summary: string;
}): AgentOperationsReadModel["activity"][number] {
  const updatedAt = `2026-07-31T15:${String(50 - input.id.length).padStart(2, "0")}:00.000Z`;
  return {
    id: input.id,
    eventId: `evt_${input.id}`,
    source: input.source,
    eventType: input.eventType,
    problemId: `problem_${input.id}`,
    problemSummary: input.summary,
    department: input.department,
    loopId: input.loopId,
    loopLabel: input.loopLabel,
    routeJobId: `job_${input.id}`,
    executionRuntime: "hermes",
    jobStatus: input.status,
    agentInstanceId: input.agent,
    agentName: input.agentName,
    runId: `run_${input.id}`,
    traceStatus: input.status === "completed" ? "COMPLETED" : input.status === "waiting_review" ? "WAITING_FOR_REVIEW" : input.status === "failed" ? "FAILED_VERIFICATION" : "COMMITTED",
    taskCount: input.tasks[0],
    completedTaskCount: input.tasks[1],
    toolCallCount: input.tools,
    approvalCount: input.approvals ?? 0,
    outputCount: input.outputs,
    observedOutcomeCount: input.outcomes,
    latestEventType: input.status === "completed" ? "run.completed" : input.status === "waiting_review" ? "approval.requested" : input.status === "failed" ? "run.failed" : input.status === "dispatched" ? "assignment.received" : "task.completed",
    latestSummary: input.summary,
    receivedAt: "2026-07-31T15:30:00.000Z",
    updatedAt,
    latencyMs: input.status === "completed" ? 41_000 : undefined,
    needsAttention: ["waiting_review", "failed", "dead_letter"].includes(input.status)
  };
}

function previewAgent(id: string, name: string, environment: "production", capabilities: string[]): AgentOperationsReadModel["agents"][number] {
  return {
    schemaVersion: "hermes-agent-instance/v1alpha1",
    id,
    workspaceId: "acme",
    organizationId: "00000000-0000-4000-8000-000000000001",
    name,
    environment,
    status: "online",
    runtimeVersion: "hermes-2.4.0",
    capabilities,
    assignedLoopIds: [],
    defaultRouter: id === "hermes-router-west",
    labels: { region: id.includes("east") ? "us-east" : "us-west" },
    lastHeartbeatAt: "2026-07-31T15:59:48.000Z",
    registeredAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-31T15:59:48.000Z",
    healthy: true,
    secondsSinceHeartbeat: 12
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
