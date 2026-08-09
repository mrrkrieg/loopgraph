import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  APP_LOOP_SCHEMA_VERSION,
  APP_SKILL_SCHEMA_VERSION,
  appLoopDefinitionSchema,
  appSkillDefinitionSchema,
  compileRoutingCardFromLoopSpec,
  contentHash,
  validateLoopSpec,
  type AppLoopDefinition,
  type AppSkillDefinition,
  type LoopSpec,
  type RoutingCard
} from "../core";
import type { LoopPackLoadResult } from "./app-pack-loader";

export type CompiledAppGraphNode = {
  id: string;
  type: "hermes_brain" | "department" | "app" | "loop";
  label: string;
  parentId?: string;
  installationScoped: boolean;
};

export type CompiledAppGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: "routes" | "owns" | "contains";
};

export type CompiledLoopPack = {
  appId: string;
  version: string;
  artifactDigest: string;
  loopSpecs: LoopSpec[];
  skills: AppSkillDefinition[];
  routingCards: RoutingCard[];
  graph: {
    nodes: CompiledAppGraphNode[];
    edges: CompiledAppGraphEdge[];
  };
};

export async function compileLoopPack(loaded: LoopPackLoadResult): Promise<CompiledLoopPack> {
  const loopSpecs: LoopSpec[] = [];
  for (const loopPath of loaded.manifest.entrypoints.loops) {
    const raw = await readPackDocument(loaded.root, loopPath);
    if (isRecord(raw) && raw.schemaVersion === APP_LOOP_SCHEMA_VERSION) {
      loopSpecs.push(compileAppLoopDefinition(appLoopDefinitionSchema.parse(raw), loaded));
    } else {
      loopSpecs.push(validateLoopSpec(raw));
    }
  }

  const skills: AppSkillDefinition[] = [];
  for (const skillPath of loaded.manifest.entrypoints.skills) {
    const raw = await readPackDocument(loaded.root, skillPath);
    if (!isRecord(raw) || raw.schemaVersion !== APP_SKILL_SCHEMA_VERSION) {
      throw new Error(`Pack skill ${skillPath} must use ${APP_SKILL_SCHEMA_VERSION}`);
    }
    skills.push(appSkillDefinitionSchema.parse(raw));
  }

  const catalogVersion = `app_${contentHash({ appId: loaded.manifest.metadata.id, digest: loaded.artifact.digest })}`;
  const routingCards = loopSpecs.map((spec) => compileRoutingCardFromLoopSpec(spec, {
    catalogVersion,
    currentReadiness: "blocked",
    loopStatus: "draft"
  })).filter((card): card is RoutingCard => Boolean(card));

  if (routingCards.length !== loopSpecs.length) {
    throw new Error("Every LoopPack loop must define a Hermes routing contract");
  }
  const loopIds = loopSpecs.map((spec) => spec.metadata.id);
  if (new Set(loopIds).size !== loopIds.length) {
    throw new Error("LoopPack contains duplicate loop IDs");
  }

  return {
    appId: loaded.manifest.metadata.id,
    version: loaded.manifest.metadata.version,
    artifactDigest: loaded.artifact.digest,
    loopSpecs,
    skills,
    routingCards,
    graph: compileAppGraph(loaded, loopSpecs)
  };
}

export function compileAppLoopDefinition(definition: AppLoopDefinition, loaded: LoopPackLoadResult): LoopSpec {
  const capabilityByTool = new Map(definition.capabilities.map((capability) => [toolKey(capability.key), capability]));
  const tools = definition.capabilities.map((capability) => ({
    key: toolKey(capability.key),
    adapterId: `capability:${capability.key}`,
    label: capability.purpose,
    writeCapable: capability.authority === "approve" || capability.authority === "execute",
    riskLevel: capability.risk
  }));
  const allowedActions = definition.capabilities.map((capability) => ({
    toolKey: toolKey(capability.key),
    allowed: capability.authority !== "execute",
    requiresApproval: capability.authority === "approve" || capability.authority === "execute",
    customerFacing: capability.customerFacing,
    riskLevel: capability.risk
  }));
  const forbiddenActions = definition.policy.forbiddenActions.map((rule) => ({
    toolKey: toolKey(rule.capability),
    reason: rule.reason
  }));
  for (const capability of definition.capabilities.filter((candidate) => candidate.authority === "execute")) {
    if (!forbiddenActions.some((action) => action.toolKey === toolKey(capability.key))) {
      forbiddenActions.push({ toolKey: toolKey(capability.key), reason: "Provider execution is forbidden until a separate promotion explicitly grants it." });
    }
  }

  const spec = {
    apiVersion: "loopgraph/v1alpha1",
    kind: "Loop",
    metadata: {
      id: definition.metadata.id,
      name: definition.metadata.name,
      version: definition.metadata.version,
      description: definition.metadata.description,
      labels: {
        appId: loaded.manifest.metadata.id,
        appVersion: loaded.manifest.metadata.version,
        appDigest: loaded.artifact.digest,
        lifecycleStatus: "draft"
      },
      owner: { role: definition.metadata.ownerRole }
    },
    trigger: definition.trigger,
    input: {
      schema: {
        type: "object",
        required: definition.input.requiredFields,
        properties: Object.fromEntries(definition.input.requiredFields.map((field) => [field, {}]))
      },
      fixtures: definition.input.fixtures
    },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "outcomes", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          outcomes: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: {
      sources: [
        { id: "app_policy", type: "policy", title: "Installed app policy", sensitivity: "internal", trusted: true, precedence: 0 },
        { id: "company_context", type: "memory", title: "Approved company context", sensitivity: "confidential", trusted: true, precedence: 1 },
        { id: "incoming_event", type: "event", title: "Hermes normalized event", sensitivity: "internal", trusted: false, precedence: 2 }
      ],
      precedence: [
        { sourceType: "policy", rank: 0 },
        { sourceType: "memory", rank: 1 },
        { sourceType: "event", rank: 2 }
      ],
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: definition.routine.map((step) => ({
        id: step.id,
        name: step.name,
        stepType: step.type,
        actor: step.actor,
        description: step.description
      }))
    },
    tools,
    policy: {
      allowedActions,
      forbiddenActions,
      escalationRules: [{
        id: "missing-context-or-risk",
        when: { any: ["required context missing", "confidence below threshold", "policy conflict"] },
        createEscalationCase: { category: "app_routing_review", severity: "P2" },
        routeTo: {
          primaryOwner: definition.policy.escalationOwner,
          reviewers: [definition.metadata.ownerRole],
          responseSla: definition.policy.escalationSla
        },
        requiresApproval: ["provider_write", "customer_facing_action"],
        decisionsRequired: ["Supply missing context or approve the bounded action"]
      }]
    },
    verification: [
      { id: "schema", type: "schema" },
      { id: "policy", type: "policy" },
      { id: "evidence", type: "evidence" },
      ...(Array.from(capabilityByTool.values()).some((capability) => capability.authority === "approve" || capability.authority === "execute")
        ? [{ id: "approval_required", type: "approval_required" as const }]
        : [])
    ],
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: definition.policy.separateCustomerFacingApproval,
      allowedRoles: ["approver", "reviewer", "owner"]
    },
    persistence: {
      idempotency: { enabled: true },
      retry: { maxAttempts: 3 }
    },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true,
      exportOpenTelemetry: true
    },
    topology: {
      department: definition.metadata.department,
      tags: ["loopgraph-app", loaded.manifest.metadata.id, ...definition.metadata.tags]
    },
    routing: {
      ...definition.routing,
      activationMode: "shadow"
    },
    studioExtension: {
      appId: loaded.manifest.metadata.id,
      appVersion: loaded.manifest.metadata.version,
      artifactDigest: loaded.artifact.digest,
      skills: definition.skills,
      outcomes: definition.outcomes
    }
  };
  return validateLoopSpec(spec);
}

function compileAppGraph(loaded: LoopPackLoadResult, specs: LoopSpec[]): CompiledLoopPack["graph"] {
  const department = loaded.manifest.metadata.department;
  const brainId = "hermes-brain";
  const departmentId = `department.${department}`;
  const appNodeId = `app.${loaded.manifest.metadata.id}`;
  const nodes: CompiledAppGraphNode[] = [
    { id: brainId, type: "hermes_brain", label: "Hermes Brain", installationScoped: false },
    { id: departmentId, type: "department", label: departmentLabel(department), parentId: brainId, installationScoped: false },
    { id: appNodeId, type: "app", label: loaded.manifest.metadata.name, parentId: departmentId, installationScoped: true },
    ...specs.map((spec) => ({ id: `loop.${spec.metadata.id}`, type: "loop" as const, label: spec.metadata.name, parentId: appNodeId, installationScoped: true }))
  ];
  const edges: CompiledAppGraphEdge[] = [
    { id: `edge.${brainId}.${departmentId}`, source: brainId, target: departmentId, type: "routes" },
    { id: `edge.${departmentId}.${appNodeId}`, source: departmentId, target: appNodeId, type: "owns" },
    ...specs.map((spec) => ({
      id: `edge.${appNodeId}.loop.${spec.metadata.id}`,
      source: appNodeId,
      target: `loop.${spec.metadata.id}`,
      type: "contains" as const
    }))
  ];
  return { nodes, edges };
}

async function readPackDocument(root: string, relativePath: string): Promise<unknown> {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Pack document escapes pack root: ${relativePath}`);
  }
  const raw = await readFile(absolute, "utf8");
  return relativePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
}

function toolKey(capability: string): string {
  return capability.replace(/[^a-zA-Z0-9]+/g, "_");
}

function departmentLabel(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

