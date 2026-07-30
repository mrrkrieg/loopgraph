import type { LoopSpec } from "../core/loop-spec";
import type { StorageAdapter } from "../sdk/adapters";
import type { ConnectionPlan, ConnectionRequiredFor } from "../core/connections";
import type { RunProvenance } from "../core/trace";
import { runLoop, type RunLoopResult } from "./loop-runner";
import { buildConnectionPlan } from "./connection-plan";

export type ExecuteResult = RunLoopResult;

export type LiveExecutionGateReason = {
  code: string;
  message: string;
  requiredAction: string;
};

export type LiveExecutionConnectorCheck = {
  capability: string;
  requiredFor: ConnectionRequiredFor;
  status: "missing" | "manual_fallback" | "connected" | "degraded";
  connectedRuntimeInstances: Array<{
    instanceId: string;
    manifestId: string;
    environment: "sandbox" | "live";
  }>;
};

export type LiveExecutionGateResult = {
  allowed: boolean;
  activationMode?: string;
  checkedAt: string;
  reasons: LiveExecutionGateReason[];
  requiredActions: string[];
  connectorChecks: LiveExecutionConnectorCheck[];
};

export type EvaluateLiveExecutionGateInput = {
  spec: LoopSpec;
  projectRoot?: string;
  connectionPlan?: ConnectionPlan;
  now?: Date;
};

export type LiveExecutionInvocation = {
  actor?: string;
  source?: string;
  userId?: string;
  sessionId?: string;
  routeAttemptId?: string;
  routeCommitId?: string;
};

const LIVE_EXECUTION_ACTIVATION_MODES = new Set(["execute_with_approval", "autonomous_low_risk"]);
const ACTION_RISK_ORDER = ["low", "medium", "high", "critical"] as const;

export function isExecuteEnabled() {
  return process.env.LOOPGRAPH_EXECUTE_ENABLED === "true";
}

export async function evaluateLiveExecutionGate(
  input: EvaluateLiveExecutionGateInput
): Promise<LiveExecutionGateResult> {
  const reasons: LiveExecutionGateReason[] = [];
  const routing = input.spec.routing;
  const activationMode = routing?.activationMode;
  const checkedAt = (input.now ?? new Date()).toISOString();

  if (!routing) {
    reasons.push({
      code: "routing_contract_required",
      message: "Live execution requires a LoopSpec routing contract so Hermes routes remain auditable.",
      requiredAction: "Add routing.problemTypes, accepts, inputMapping, activationMode, and requiredConnections before promoting this loop."
    });
  } else if (!LIVE_EXECUTION_ACTIVATION_MODES.has(routing.activationMode)) {
    reasons.push({
      code: "activation_mode_not_live",
      message: `Loop activationMode=${activationMode} is not a live execution mode.`,
      requiredAction: "Keep routing through Hermes in local simulation, then promote the loop to execute_with_approval or autonomous_low_risk after review."
    });
  }

  if (input.spec.trigger.type === "webhook" && !isHermesSource(input.spec.trigger.source)) {
    reasons.push({
      code: "webhooks_must_enter_through_hermes",
      message: `Live webhook execution cannot start directly from source "${input.spec.trigger.source}".`,
      requiredAction: "Point provider webhooks at Hermes and execute only Hermes-normalized events through Loopgraph."
    });
  }

  reasons.push(...evaluateActionPolicyGate(input.spec, activationMode));
  const connectionGate = await evaluateConnectionGate(input);
  reasons.push(...connectionGate.reasons);

  return {
    allowed: reasons.length === 0,
    ...(activationMode ? { activationMode } : {}),
    checkedAt,
    reasons,
    requiredActions: Array.from(new Set(reasons.map((reason) => reason.requiredAction))),
    connectorChecks: connectionGate.connectorChecks
  };
}

export function formatLiveExecutionGateError(result: LiveExecutionGateResult): string {
  return [
    "Live execution gate failed:",
    ...result.reasons.map((reason) => `- ${reason.message} Required action: ${reason.requiredAction}`)
  ].join("\n");
}

export async function executeLoop(input: {
  spec: LoopSpec;
  triggerPayload: Record<string, unknown>;
  eventId: string;
  startedAt?: string;
  storage: StorageAdapter;
  projectRoot?: string;
  connectionPlan?: ConnectionPlan;
  invokedBy?: LiveExecutionInvocation;
}): Promise<ExecuteResult> {
  if (!isExecuteEnabled()) {
    throw new Error("Execute mode is disabled. Set LOOPGRAPH_EXECUTE_ENABLED=true");
  }

  const gate = await evaluateLiveExecutionGate({
    spec: input.spec,
    projectRoot: input.projectRoot,
    connectionPlan: input.connectionPlan
  });
  if (!gate.allowed) {
    throw new Error(formatLiveExecutionGateError(gate));
  }

  return runLoop({
    spec: input.spec,
    mode: "execute",
    triggerPayload: input.triggerPayload,
    eventId: input.eventId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    storage: input.storage,
    provenance: buildExecutionProvenance({
      spec: input.spec,
      gate,
      invokedBy: input.invokedBy
    })
  });
}

function evaluateActionPolicyGate(
  spec: LoopSpec,
  activationMode: string | undefined
): LiveExecutionGateReason[] {
  const reasons: LiveExecutionGateReason[] = [];
  const allowedByTool = new Map(spec.policy.allowedActions.map((action) => [action.toolKey, action]));
  const writeCapableTools = spec.tools.filter((tool) => tool.writeCapable);

  for (const tool of writeCapableTools) {
    const policy = allowedByTool.get(tool.key);
    const riskLevel = highestRisk(tool.riskLevel, policy?.riskLevel);

    if (!policy || !policy.allowed) {
      reasons.push({
        code: "write_tool_policy_missing",
        message: `Write-capable tool "${tool.key}" is not explicitly allowed by policy.allowedActions.`,
        requiredAction: `Add an allowed policy entry for "${tool.key}" or remove the write-capable binding.`
      });
      continue;
    }

    if (activationMode === "autonomous_low_risk" && riskLevel !== "low") {
      reasons.push({
        code: "autonomous_write_risk_too_high",
        message: `Tool "${tool.key}" is ${riskLevel} risk, but autonomous_low_risk only allows low-risk writes.`,
        requiredAction: `Change "${tool.key}" to execute_with_approval or redesign it as a low-risk draft/read action.`
      });
    }

    if (activationMode === "autonomous_low_risk" && policy.customerFacing) {
      reasons.push({
        code: "autonomous_customer_facing_blocked",
        message: `Tool "${tool.key}" is customer-facing and cannot run autonomously.`,
        requiredAction: `Move "${tool.key}" to execute_with_approval with separate customer-facing approval.`
      });
    }

    if (riskLevel !== "low" && !policy.requiresApproval) {
      reasons.push({
        code: "risky_write_requires_approval",
        message: `Tool "${tool.key}" is ${riskLevel} risk but does not require approval.`,
        requiredAction: `Set policy.allowedActions for "${tool.key}" to requiresApproval=true.`
      });
    }

    if (policy.customerFacing && !policy.requiresApproval) {
      reasons.push({
        code: "customer_facing_requires_approval",
        message: `Customer-facing tool "${tool.key}" does not require approval.`,
        requiredAction: `Set policy.allowedActions for "${tool.key}" to requiresApproval=true.`
      });
    }

    if (policy.requiresApproval && !spec.approval.requireFingerprintMatch) {
      reasons.push({
        code: "fingerprint_approval_required",
        message: `Tool "${tool.key}" requires approval but approval.requireFingerprintMatch is disabled.`,
        requiredAction: "Enable approval.requireFingerprintMatch so the approved payload cannot change after review."
      });
    }

    if (policy.customerFacing && !spec.approval.separateCustomerFacingApproval) {
      reasons.push({
        code: "customer_facing_separation_required",
        message: `Customer-facing tool "${tool.key}" is not protected by a separate customer-facing approval gate.`,
        requiredAction: "Enable approval.separateCustomerFacingApproval before allowing customer-facing actions."
      });
    }
  }

  for (const action of spec.policy.allowedActions.filter((policy) => policy.allowed)) {
    if (activationMode === "execute_with_approval" && !action.requiresApproval) {
      reasons.push({
        code: "execute_with_approval_action_missing_approval",
        message: `Allowed action "${action.toolKey}" is not approval-bound in execute_with_approval mode.`,
        requiredAction: `Set policy.allowedActions for "${action.toolKey}" to requiresApproval=true or change the loop activation mode.`
      });
    }
    if (activationMode === "autonomous_low_risk" && action.riskLevel !== "low") {
      reasons.push({
        code: "autonomous_policy_risk_too_high",
        message: `Allowed action "${action.toolKey}" is ${action.riskLevel} risk, but autonomous_low_risk only permits low-risk actions.`,
        requiredAction: `Change "${action.toolKey}" to execute_with_approval or lower the action risk after redesign.`
      });
    }
    if (action.customerFacing && !spec.approval.separateCustomerFacingApproval) {
      reasons.push({
        code: "customer_facing_policy_separation_required",
        message: `Allowed action "${action.toolKey}" is customer-facing without separate customer-facing approval.`,
        requiredAction: "Enable approval.separateCustomerFacingApproval before allowing customer-facing actions."
      });
    }
    if (action.riskLevel !== "low" && !action.requiresApproval) {
      reasons.push({
        code: "risky_policy_requires_approval",
        message: `Allowed action "${action.toolKey}" is ${action.riskLevel} risk but does not require approval.`,
        requiredAction: `Set policy.allowedActions for "${action.toolKey}" to requiresApproval=true.`
      });
    }
  }

  return dedupeReasons(reasons);
}

async function evaluateConnectionGate(input: EvaluateLiveExecutionGateInput): Promise<{
  reasons: LiveExecutionGateReason[];
  connectorChecks: LiveExecutionConnectorCheck[];
}> {
  const requirements = liveConnectionRequirementsForSpec(input.spec);
  if (requirements.length === 0) return { reasons: [], connectorChecks: [] };

  const plan = input.connectionPlan ?? (input.projectRoot ? await buildConnectionPlan({ projectRoot: input.projectRoot }) : undefined);
  if (!plan) {
    return {
      reasons: [{
        code: "project_root_required_for_connection_gate",
        message: "Live execution has declared connector requirements, but no project root or connection plan was provided.",
        requiredAction: "Pass projectRoot to executeLoop so Loopgraph can verify connector readiness before execution."
      }],
      connectorChecks: requirements.map((requirement) => ({
        capability: requirement.capability,
        requiredFor: requirement.requiredFor,
        status: "missing",
        connectedRuntimeInstances: []
      }))
    };
  }

  const reasons: LiveExecutionGateReason[] = [];
  const connectorChecks: LiveExecutionConnectorCheck[] = [];
  const planByCapability = new Map(plan.items.map((item) => [item.capability, item]));

  for (const requirement of requirements) {
    const item = planByCapability.get(requirement.capability);
    const connectedRuntimeInstances = item?.compatibleConnections
      .filter((connection) => connection.status === "connected" && connection.environment !== "simulate")
      .map((connection) => ({
        instanceId: connection.instanceId,
        manifestId: connection.manifestId,
        environment: connection.environment as "sandbox" | "live"
      })) ?? [];
    const status = item?.status ?? "missing";
    connectorChecks.push({
      capability: requirement.capability,
      requiredFor: requirement.requiredFor,
      status,
      connectedRuntimeInstances
    });

    if (!item) {
      reasons.push({
        code: "connection_requirement_missing_from_plan",
        message: `Required ${requirement.requiredFor} connector capability "${requirement.capability}" is missing from the connection plan.`,
        requiredAction: `Add a connector or manual project plan entry for "${requirement.capability}".`
      });
      continue;
    }

    if (item.status !== "connected" || connectedRuntimeInstances.length === 0) {
      const environmentHint = item.compatibleConnections.length > 0
        ? ` Compatible environments: ${item.compatibleConnections.map((connection) => connection.environment).join(", ")}.`
        : "";
      reasons.push({
        code: "connection_not_ready_for_live_execution",
        message: `Connector capability "${requirement.capability}" is ${item.status}, not live/sandbox connected.${environmentHint}`,
        requiredAction: `Connect "${requirement.capability}" with a non-simulated connected instance before live execution.`
      });
    }
  }

  return {
    reasons: dedupeReasons(reasons),
    connectorChecks
  };
}

function liveConnectionRequirementsForSpec(spec: LoopSpec): Array<{ capability: string; requiredFor: ConnectionRequiredFor }> {
  const requirements = new Map<string, { capability: string; requiredFor: ConnectionRequiredFor }>();

  for (const capability of spec.routing?.requiredConnections ?? []) {
    requirements.set(`${capability}:routing`, { capability, requiredFor: "routing" });
  }

  const extension = hermesDesignExtension(spec);
  for (const requirement of extension?.connectorRequirements ?? []) {
    const capability = typeof requirement.capability === "string" ? requirement.capability.trim() : "";
    if (!capability) continue;
    const requiredFor = parseConnectionRequiredFor(requirement.requiredFor) ?? "execution";
    if (requiredFor === "design" || requiredFor === "simulation") continue;
    requirements.set(`${capability}:${requiredFor}`, { capability, requiredFor });
  }

  return Array.from(requirements.values());
}

function hermesDesignExtension(spec: LoopSpec): {
  connectorRequirements?: Array<{ capability?: unknown; requiredFor?: unknown }>;
} | undefined {
  const value = spec.studioExtension?.hermesDesign;
  return value && typeof value === "object"
    ? value as { connectorRequirements?: Array<{ capability?: unknown; requiredFor?: unknown }> }
    : undefined;
}

function parseConnectionRequiredFor(value: unknown): ConnectionRequiredFor | undefined {
  if (value === "design" || value === "simulation" || value === "execution" || value === "routing") return value;
  return undefined;
}

function isHermesSource(source: string): boolean {
  return ["hermes", "hermes_agent", "hermes-agent", "loopgraph-hermes"].includes(source.trim().toLowerCase());
}

function buildExecutionProvenance(input: {
  spec: LoopSpec;
  gate: LiveExecutionGateResult;
  invokedBy?: LiveExecutionInvocation;
}): RunProvenance {
  return {
    invocation: {
      actor: input.invokedBy?.actor ?? "cli",
      source: input.invokedBy?.source ?? "loopgraph.execute",
      ...(input.invokedBy?.userId ? { userId: input.invokedBy.userId } : {}),
      ...(input.invokedBy?.sessionId ? { sessionId: input.invokedBy.sessionId } : {}),
      ...(input.invokedBy?.routeAttemptId ? { routeAttemptId: input.invokedBy.routeAttemptId } : {}),
      ...(input.invokedBy?.routeCommitId ? { routeCommitId: input.invokedBy.routeCommitId } : {})
    },
    liveExecutionGate: {
      checkedAt: input.gate.checkedAt,
      allowed: input.gate.allowed,
      ...(input.gate.activationMode ? { activationMode: input.gate.activationMode } : {}),
      reasonCodes: input.gate.reasons.map((reason) => reason.code),
      requiredActions: input.gate.requiredActions
    },
    approvalPolicy: {
      requireFingerprintMatch: input.spec.approval.requireFingerprintMatch,
      separateCustomerFacingApproval: input.spec.approval.separateCustomerFacingApproval,
      allowedRoles: input.spec.approval.allowedRoles
    },
    connectorChecks: input.gate.connectorChecks
  };
}

function highestRisk(
  left: (typeof ACTION_RISK_ORDER)[number],
  right?: (typeof ACTION_RISK_ORDER)[number]
): (typeof ACTION_RISK_ORDER)[number] {
  if (!right) return left;
  return riskIndex(left) > riskIndex(right) ? left : right;
}

function riskIndex(risk: (typeof ACTION_RISK_ORDER)[number]): number {
  return ACTION_RISK_ORDER.indexOf(risk);
}

function dedupeReasons(reasons: LiveExecutionGateReason[]): LiveExecutionGateReason[] {
  return Array.from(new Map(reasons.map((reason) => [
    `${reason.code}:${reason.message}:${reason.requiredAction}`,
    reason
  ])).values());
}
