import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  BusinessDiscoverySessionSchema,
  contentHash,
  formatDepartmentType,
  validateLoopSpec,
  type LoopDesignProposal,
  type LoopDesignProposalSet,
  type AgentRunOutput,
  type LoopSpec,
  compileRoutingCardFromLoopSpec,
  type RoutingCard
} from "../core";
import { loadLoopSpecFromPath } from "./loader";
import {
  createStoredLoopSpecArtifact,
  type LoopSpecRegistryStore,
  type StoredLoopSpecArtifact
} from "./loop-spec-store";
import { readDesignRun, readLoopDesignProposalSet } from "./design-service";
import type { DiscoveryDesignStore } from "./discovery-design-store";
import { getDiscoverySession, saveDiscoverySession, type DiscoveryActor } from "./discovery-session";
import { getLoopgraphRoot } from "./storage-resolver";
import {
  initLoopgraphWorkspace,
  inspectLoopgraphWorkspace,
  readLoopgraphWorkspace,
  writeLoopgraphWorkspace,
  type LoopgraphWorkspaceRegistry,
  type RegisteredLoopSpec
} from "./workspace";

export const LOOP_MATERIALIZATION_SCHEMA_VERSION = "loop-materialization/v1alpha1" as const;

export type MaterializeLoopDesignInput = {
  projectRoot?: string;
  store?: DiscoveryDesignStore;
  loopSpecStore?: LoopSpecRegistryStore;
  designRunId: string;
  acceptedProposalIds: string[];
  acceptedBy?: string;
  overwriteExisting?: boolean;
  allowedExistingLoopIds?: string[];
  now?: Date;
};

export type LoopListInput = {
  projectRoot?: string;
};

export type HermesGraphProjectionNode = {
  id: string;
  label: string;
  type: "company_brain" | "department" | "loop" | "connector" | "metric" | "event" | "problem" | "learning_context" | "route_commit" | "route_job" | "opportunity" | "graph_change";
};

export type HermesGraphProjectionEdge = {
  source: string;
  target: string;
  label: string;
  executable: boolean;
};

export type HermesGraphProjection = {
  nodes: HermesGraphProjectionNode[];
  edges: HermesGraphProjectionEdge[];
};

export type MaterializedLoop = {
  proposalId: string;
  loopId: string;
  name: string;
  department: string;
  status: "created" | "already_materialized" | "updated";
  specPath: string;
  relativeSpecPath: string;
  routingCard: RoutingCard;
  requiredConnections: LoopDesignProposal["connectorRequirements"];
  requiredFromUser: LoopDesignProposal["requiredFromUser"];
  simulation: {
    needsFixture: boolean;
    command: string;
    starterFixtures: StarterFixtureRef[];
  };
};

export type StarterFixtureRef = {
  id: "happy-path" | "missing-context" | "risk-escalation";
  label: string;
  path: string;
  relativePath: string;
};

export type LoopMaterializationResult = {
  schemaVersion: typeof LOOP_MATERIALIZATION_SCHEMA_VERSION;
  valid: boolean;
  errors: string[];
  projectRoot: string;
  sessionId?: string;
  designRunId: string;
  materializationId: string;
  materializedAt: string;
  acceptedProposalIds: string[];
  materializedLoops: MaterializedLoop[];
  graphProjection: HermesGraphProjection;
  workspace: {
    registeredSpecCount: number;
    registeredDepartments: string[];
    routingReadySpecCount: number;
  };
  nextActions: string[];
  materializationPath?: string;
};

export type LoopListResult = {
  projectRoot: string;
  count: number;
  loops: Array<{
    loopId: string;
    name: string;
    department: string;
    specPath: string;
    routingReady: boolean;
    problemTypes: string[];
    activationMode?: string;
    loadErrors: string[];
    routingCard?: RoutingCard;
  }>;
  graphProjection: HermesGraphProjection;
};

type PreparedMaterialization = {
  proposal: LoopDesignProposal;
  spec: LoopSpec;
  specPath: string;
  relativeSpecPath: string;
  status: MaterializedLoop["status"];
};

type MaterializationTransactionItem = {
  prepared: PreparedMaterialization;
  stagedDir: string;
  finalDir: string;
  backupDir: string;
  finalExisted: boolean;
  promoted: boolean;
};

type MaterializationTransaction = {
  stagingDir: string;
  items: MaterializationTransactionItem[];
};

const STARTER_FIXTURE_DEFINITIONS: Array<{
  id: StarterFixtureRef["id"];
  label: string;
}> = [
  { id: "happy-path", label: "Synthetic happy path" },
  { id: "missing-context", label: "Synthetic missing context" },
  { id: "risk-escalation", label: "Synthetic risk/escalation" }
];

export async function materializeAcceptedLoopDesignProposals(
  input: MaterializeLoopDesignInput
): Promise<LoopMaterializationResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const acceptedProposalIds = uniqueStrings(input.acceptedProposalIds);
  const materializedAt = (input.now ?? new Date()).toISOString();
  const materializationId = `materialization_${contentHash({
    designRunId: input.designRunId,
    acceptedProposalIds,
    acceptedBy: input.acceptedBy ?? "unknown",
    at: materializedAt
  })}`;

  if (!input.loopSpecStore || input.loopSpecStore.persistence === "file") {
    await initLoopgraphWorkspace({
      projectRoot,
      createdBy: "hermes",
      now: input.now
    });
  }
  const designRun = await readDesignRun(
    projectRoot,
    input.designRunId,
    input.store
  );
  const proposalSet = await readLoopDesignProposalSet(
    projectRoot,
    input.designRunId,
    input.store
  );
  const fatalErrors = validateMaterializationRequest({
    designRunId: input.designRunId,
    acceptedProposalIds,
    proposalSet,
    designRunValidationErrors: designRun?.validationErrors,
    allowedExistingLoopIds: input.allowedExistingLoopIds
  });

  if (fatalErrors.length > 0 || !proposalSet || !designRun) {
    const workspace = await readMaterializationWorkspace(
      projectRoot,
      input.loopSpecStore
    );
    return {
      schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
      valid: false,
      errors: fatalErrors.length > 0 ? fatalErrors : [`Design run not found: ${input.designRunId}`],
      projectRoot,
      sessionId: designRun?.sessionId,
      designRunId: input.designRunId,
      materializationId,
      materializedAt,
      acceptedProposalIds,
      materializedLoops: [],
      graphProjection: { nodes: [], edges: [] },
      workspace,
      nextActions: ["Generate or submit a valid Hermes loop design before materializing proposals."]
    };
  }

  const selectedProposals = proposalSet.proposals.filter((proposal) => acceptedProposalIds.includes(proposal.proposalId));
  const preflight = await prepareMaterializations({
    projectRoot,
    designRunId: input.designRunId,
    proposalSet,
    selectedProposals,
    materializedAt,
    overwriteExisting: input.overwriteExisting ?? false,
    loopSpecStore: input.loopSpecStore
  });

  if (preflight.errors.length > 0) {
    const workspace = await readMaterializationWorkspace(
      projectRoot,
      input.loopSpecStore
    );
    return {
      schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
      valid: false,
      errors: preflight.errors,
      projectRoot,
      sessionId: designRun.sessionId,
      designRunId: input.designRunId,
      materializationId,
      materializedAt,
      acceptedProposalIds,
      materializedLoops: [],
      graphProjection: graphProjectionFromProposals(selectedProposals),
      workspace,
      nextActions: [
        "Resolve materialization errors, then call loopgraph_loops_materialize again with the accepted proposal IDs."
      ]
    };
  }

  const materializedLoops = preflight.prepared.map((prepared) => materializedLoopFromPrepared(prepared));
  if (input.loopSpecStore?.persistence === "distributed") {
    return commitDistributedMaterialization({
      ...input,
      projectRoot,
      loopSpecStore: input.loopSpecStore,
      acceptedProposalIds,
      materializedAt,
      materializationId,
      designRun,
      selectedProposals,
      prepared: preflight.prepared,
      materializedLoops
    });
  }
  const registryBeforeTransaction = await readLoopgraphWorkspace(projectRoot);
  const sessionBeforeTransaction = designRun.sessionId
    ? await getDiscoverySession(designRun.sessionId, projectRoot, input.store)
    : undefined;
  let transaction: MaterializationTransaction | undefined;

  try {
    transaction = await stageMaterializationTransaction({
      projectRoot,
      materializationId,
      prepared: preflight.prepared,
      materializedAt
    });

    await promoteMaterializationTransaction(transaction);

    await registerPreparedSpecs({
      projectRoot,
      prepared: preflight.prepared,
      materializedAt
    });

    const workspace = await inspectLoopgraphWorkspace({ projectRoot });
    const result: LoopMaterializationResult = {
      schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
      valid: true,
      errors: [],
      projectRoot,
      sessionId: designRun.sessionId,
      designRunId: input.designRunId,
      materializationId,
      materializedAt,
      acceptedProposalIds,
      materializedLoops,
      graphProjection: graphProjectionFromProposals(selectedProposals),
      workspace: workspaceSummary(workspace),
      nextActions: nextActionsForMaterializedLoops(materializedLoops),
      materializationPath: materializationFilePath(projectRoot, materializationId)
    };

    await writeJson(result.materializationPath!, result);
    if (designRun.sessionId) {
      await appendMaterializedLoopsToDiscoverySession({
        projectRoot,
        store: input.store,
        sessionId: designRun.sessionId,
        loopIds: materializedLoops.map((loop) => loop.loopId),
        actor: normalizeDiscoveryActor(input.acceptedBy),
        materializedAt
      });
    }
    await cleanupMaterializationTransaction(transaction);
    return result;
  } catch (error) {
    if (transaction) await rollbackMaterializationTransaction(transaction);
    await writeLoopgraphWorkspace(registryBeforeTransaction, projectRoot);
    if (sessionBeforeTransaction) {
      const current = await getDiscoverySession(
        sessionBeforeTransaction.id,
        projectRoot,
        input.store
      );
      if (
        current &&
        current.revision === sessionBeforeTransaction.revision + 1
      ) {
        await saveDiscoverySession(
          BusinessDiscoverySessionSchema.parse({
            ...sessionBeforeTransaction,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString()
          }),
          projectRoot,
          {
            store: input.store,
            expectedRevision: current.revision
          }
        );
      }
    }
    await rm(materializationFilePath(projectRoot, materializationId), { force: true });
    const workspace = await inspectLoopgraphWorkspace({ projectRoot });
    return {
      schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
      valid: false,
      errors: [`Atomic materialization failed before commit: ${error instanceof Error ? error.message : String(error)}`],
      projectRoot,
      sessionId: designRun.sessionId,
      designRunId: input.designRunId,
      materializationId,
      materializedAt,
      acceptedProposalIds,
      materializedLoops: [],
      graphProjection: graphProjectionFromProposals(selectedProposals),
      workspace: workspaceSummary(workspace),
      nextActions: [
        "No LoopSpecs were committed. Fix the filesystem or conflicting generated paths, then retry materialization."
      ]
    };
  }
}

async function commitDistributedMaterialization(input: {
  projectRoot: string;
  store?: DiscoveryDesignStore;
  loopSpecStore: LoopSpecRegistryStore;
  designRunId: string;
  acceptedProposalIds: string[];
  acceptedBy?: string;
  materializedAt: string;
  materializationId: string;
  designRun: NonNullable<Awaited<ReturnType<typeof readDesignRun>>>;
  selectedProposals: LoopDesignProposal[];
  prepared: PreparedMaterialization[];
  materializedLoops: MaterializedLoop[];
}): Promise<LoopMaterializationResult> {
  const workspaceBefore = await input.loopSpecStore.getWorkspace(
    input.projectRoot
  );
  const existingEntries = new Map(
    workspaceBefore.workspace.registeredSpecs.map((entry) => [entry.id, entry])
  );
  const artifacts = input.prepared.map((prepared) => {
    const entry: RegisteredLoopSpec = {
      id: prepared.spec.metadata.id,
      name: prepared.spec.metadata.name,
      path: prepared.relativeSpecPath,
      templateId: "hermes-design",
      department: prepared.proposal.department,
      addedAt:
        existingEntries.get(prepared.spec.metadata.id)?.addedAt ??
        input.materializedAt
    };
    return createStoredLoopSpecArtifact({
      spec: prepared.spec,
      entry,
      fixtures: Object.fromEntries(
        STARTER_FIXTURE_DEFINITIONS.map((fixture) => [
          `fixtures/${fixture.id}.json`,
          createStarterFixture({
            proposal: prepared.proposal,
            spec: prepared.spec,
            fixtureId: fixture.id,
            label: fixture.label,
            materializedAt: input.materializedAt
          })
        ])
      ),
      source: "hermes_design",
      createdAt: input.materializedAt
    });
  });
  try {
    const discoverySessionTransition =
      await buildDistributedDiscoveryTransition(input);
    const committed = await input.loopSpecStore.commitMaterializationAtomically({
      commitId: input.materializationId,
      idempotencyKey: input.materializationId,
      expectedRevision: workspaceBefore.revision,
      projectRoot: input.projectRoot,
      committedAt: input.materializedAt,
      artifacts,
      ...(discoverySessionTransition
        ? { discoverySessionTransition }
        : {})
    });
    const committedById = new Map(
      committed.artifacts.map((artifact) => [artifact.loopId, artifact])
    );
    const loops = input.materializedLoops.map((loop) => {
      const artifact = committedById.get(loop.loopId);
      if (!artifact) {
        throw new Error(
          `Atomic LoopSpec commit omitted materialized loop: ${loop.loopId}`
        );
      }
      const sourceRef = artifact.sourceRef ?? artifact.entry.path;
      return {
        ...loop,
        specPath: sourceRef,
        relativeSpecPath: sourceRef,
        simulation: {
          ...loop.simulation,
          command: `Route a synthetic shadow event through Hermes for ${loop.loopId}`,
          starterFixtures: STARTER_FIXTURE_DEFINITIONS.map((fixture) => ({
            ...fixture,
            path: `${sourceRef}#fixtures/${fixture.id}.json`,
            relativePath: `fixtures/${fixture.id}.json`
          }))
        }
      };
    });
    return {
      schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
      valid: true,
      errors: [],
      projectRoot: input.projectRoot,
      sessionId: input.designRun.sessionId,
      designRunId: input.designRunId,
      materializationId: input.materializationId,
      materializedAt: input.materializedAt,
      acceptedProposalIds: input.acceptedProposalIds,
      materializedLoops: loops,
      graphProjection: graphProjectionFromProposals(input.selectedProposals),
      workspace: workspaceSummaryFromArtifacts(
        committed.workspace,
        committed.artifacts
      ),
      nextActions: [
        ...nextActionsForMaterializedLoops(loops),
        "Hermes now reads these active versions from the tenant registry; no hosted runtime file is required."
      ],
      materializationPath: committed.commitRef
    };
  } catch (error) {
    return {
      schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
      valid: false,
      errors: [
        `Atomic distributed materialization failed before commit: ${
          error instanceof Error ? error.message : String(error)
        }`
      ],
      projectRoot: input.projectRoot,
      sessionId: input.designRun.sessionId,
      designRunId: input.designRunId,
      materializationId: input.materializationId,
      materializedAt: input.materializedAt,
      acceptedProposalIds: input.acceptedProposalIds,
      materializedLoops: [],
      graphProjection: graphProjectionFromProposals(input.selectedProposals),
      workspace: await readMaterializationWorkspace(
        input.projectRoot,
        input.loopSpecStore
      ),
      nextActions: [
        "No LoopSpec registry version or discovery transition was committed. Resolve the conflict and retry the accepted proposal set."
      ]
    };
  }
}

async function buildDistributedDiscoveryTransition(input: {
  projectRoot: string;
  store?: DiscoveryDesignStore;
  designRun: NonNullable<Awaited<ReturnType<typeof readDesignRun>>>;
  materializedLoops: MaterializedLoop[];
  acceptedBy?: string;
  materializedAt: string;
}) {
  if (!input.designRun.sessionId) return undefined;
  const session = await getDiscoverySession(
    input.designRun.sessionId,
    input.projectRoot,
    input.store
  );
  if (!session) {
    throw new Error(
      `Discovery session not found: ${input.designRun.sessionId}`
    );
  }
  const loopIds = input.materializedLoops.map((loop) => loop.loopId);
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    status: "completed",
    activeStage: "materialization",
    createdLoopIds: uniqueStrings([...session.createdLoopIds, ...loopIds]),
    revision: session.revision + 1,
    lastActor: normalizeDiscoveryActor(input.acceptedBy),
    lastTransitionAt: input.materializedAt,
    updatedAt: input.materializedAt
  });
  return {
    expectedRevision: session.revision,
    session: next
  };
}

export async function readLoopMaterializationResult(
  projectRoot: string,
  materializationId: string
): Promise<LoopMaterializationResult | undefined> {
  try {
    const data = JSON.parse(await readFile(materializationFilePath(path.resolve(projectRoot), materializationId), "utf8")) as LoopMaterializationResult;
    return data?.schemaVersion === LOOP_MATERIALIZATION_SCHEMA_VERSION ? data : undefined;
  } catch {
    return undefined;
  }
}

export async function listLoopgraphLoops(input: LoopListInput = {}): Promise<LoopListResult> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const workspace = await inspectLoopgraphWorkspace({ projectRoot });
  const loops: LoopListResult["loops"] = [];
  const graphNodes: HermesGraphProjectionNode[] = [{ id: "company_brain", label: "Hermes Brain", type: "company_brain" }];
  const graphEdges: HermesGraphProjectionEdge[] = [];

  for (const entry of workspace.registry.registeredSpecs) {
    const specPath = path.isAbsolute(entry.path) ? entry.path : path.resolve(projectRoot, entry.path);
    const loaded = await loadLoopSpecFromPath(specPath);
    const departmentId = `department:${entry.department}`;
    graphNodes.push({
      id: departmentId,
      label: formatDepartmentType(entry.department),
      type: "department"
    });
    graphEdges.push({
      source: "company_brain",
      target: departmentId,
      label: "routes business problems",
      executable: false
    });

    if (!loaded.ok) {
      loops.push({
        loopId: entry.id,
        name: entry.name,
        department: entry.department,
        specPath,
        routingReady: false,
        problemTypes: [],
        loadErrors: loaded.errors
      });
      continue;
    }

    const routingCard = loaded.spec.routing
      ? compileRoutingCardFromLoopSpec(loaded.spec, { catalogVersion: "registered" })
      : undefined;
    graphNodes.push({
      id: `loop:${loaded.spec.metadata.id}`,
      label: loaded.spec.metadata.name,
      type: "loop"
    });
    graphEdges.push({
      source: departmentId,
      target: `loop:${loaded.spec.metadata.id}`,
      label: "workflow loop",
      executable: Boolean(routingCard)
    });
    loops.push({
      loopId: loaded.spec.metadata.id,
      name: loaded.spec.metadata.name,
      department: entry.department,
      specPath,
      routingReady: Boolean(routingCard),
      problemTypes: loaded.spec.routing?.problemTypes ?? [],
      activationMode: loaded.spec.routing?.activationMode,
      loadErrors: [],
      ...(routingCard ? { routingCard } : {})
    });
  }

  return {
    projectRoot,
    count: loops.length,
    loops,
    graphProjection: dedupeGraphProjection({ nodes: graphNodes, edges: graphEdges })
  };
}

function validateMaterializationRequest(input: {
  designRunId: string;
  acceptedProposalIds: string[];
  proposalSet?: LoopDesignProposalSet;
  designRunValidationErrors?: string[];
  allowedExistingLoopIds?: string[];
}): string[] {
  const errors: string[] = [];
  if (input.acceptedProposalIds.length === 0) {
    errors.push("acceptedProposalIds must contain at least one explicitly accepted proposal ID.");
  }
  if (!input.proposalSet) {
    errors.push(`Proposal set not found for design run: ${input.designRunId}`);
    return errors;
  }
  const selectedLoopIds = new Set(input.proposalSet.proposals
    .filter((proposal) => input.acceptedProposalIds.includes(proposal.proposalId))
    .map((proposal) => proposal.loopSpecId));
  const allowedExistingLoopIds = new Set(input.allowedExistingLoopIds ?? []);
  const remainingDesignErrors = filterMaterializationValidationErrors(
    input.designRunValidationErrors ?? [],
    selectedLoopIds,
    allowedExistingLoopIds
  );
  if (remainingDesignErrors.length > 0) {
    errors.push(`Design run has validation errors:\n- ${remainingDesignErrors.join("\n- ")}`);
  }
  const remainingProposalErrors = filterMaterializationValidationErrors(
    input.proposalSet.validationSummary.errors,
    selectedLoopIds,
    allowedExistingLoopIds
  );
  if (remainingProposalErrors.length > 0) {
    errors.push(`Proposal set is not valid:\n- ${remainingProposalErrors.join("\n- ")}`);
  }
  const proposalIds = new Set(input.proposalSet.proposals.map((proposal) => proposal.proposalId));
  for (const proposalId of input.acceptedProposalIds) {
    if (!proposalIds.has(proposalId)) {
      errors.push(`Accepted proposal not found in proposal set: ${proposalId}`);
    }
  }
  return errors;
}

function filterMaterializationValidationErrors(
  errors: string[],
  selectedLoopIds: Set<string>,
  allowedExistingLoopIds: Set<string>
) {
  return errors.filter((error) => {
    const duplicate = /^Proposal duplicates an existing loop: (.+)$/.exec(error);
    if (!duplicate) return true;
    const loopId = duplicate[1]!;
    if (!selectedLoopIds.has(loopId)) return false;
    return !allowedExistingLoopIds.has(loopId);
  });
}

async function prepareMaterializations(input: {
  projectRoot: string;
  designRunId: string;
  proposalSet: LoopDesignProposalSet;
  selectedProposals: LoopDesignProposal[];
  materializedAt: string;
  overwriteExisting: boolean;
  loopSpecStore?: LoopSpecRegistryStore;
}): Promise<{ prepared: PreparedMaterialization[]; errors: string[] }> {
  const registry = input.loopSpecStore
    ? (await input.loopSpecStore.getWorkspace(input.projectRoot)).workspace
    : await readLoopgraphWorkspace(input.projectRoot);
  const activeArtifacts = input.loopSpecStore
    ? await input.loopSpecStore.listActiveLoopSpecs(input.projectRoot)
    : [];
  const errors: string[] = [];
  const prepared: PreparedMaterialization[] = [];
  const existingById = new Map(registry.registeredSpecs.map((entry) => [entry.id, entry]));
  const artifactById = new Map(
    activeArtifacts.map((artifact) => [artifact.loopId, artifact])
  );

  for (const proposal of input.selectedProposals) {
    const specPath = materializedSpecPath(input.projectRoot, proposal);
    const relativeSpecPath = path.relative(input.projectRoot, specPath);
    const spec = materializeProposalToLoopSpec({
      proposal,
      proposalSet: input.proposalSet,
      designRunId: input.designRunId,
      materializedAt: input.materializedAt
    });
    const existing = existingById.get(spec.metadata.id);
    const existingStatus = await existingMaterializationStatus({
      projectRoot: input.projectRoot,
      existing,
      proposal,
      designRunId: input.designRunId,
      expectedSpecPath: specPath,
      activeArtifact: artifactById.get(spec.metadata.id)
    });

    if (existing && existingStatus === "conflict" && !input.overwriteExisting) {
      errors.push(`Loop ID already exists in workspace and was not created by this design run: ${spec.metadata.id}`);
      continue;
    }

    prepared.push({
      proposal,
      spec,
      specPath,
      relativeSpecPath,
      status: existingStatus === "same" ? "already_materialized" : existing ? "updated" : "created"
    });
  }

  return { prepared, errors };
}

function materializeProposalToLoopSpec(input: {
  proposal: LoopDesignProposal;
  proposalSet: LoopDesignProposalSet;
  designRunId: string;
  materializedAt: string;
}): LoopSpec {
  const { proposal } = input;
  const allowedActions = proposal.proposedActions.map((action) => ({
    toolKey: action.key,
    allowed: true,
    requiresApproval: action.requiresApproval,
    customerFacing: action.customerFacing,
    riskLevel: action.riskLevel
  }));
  const spec: LoopSpec = {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: proposal.loopSpecId,
      name: proposal.shortName,
      version: "1.0.0",
      description: `${proposal.goal}\n\nBusiness outcome: ${proposal.businessOutcome}\n\nDesign summary: ${proposal.reasoningSummary}`,
      labels: {
        source: "hermes-design",
        department: proposal.department,
        proposalId: proposal.proposalId,
        designRunId: input.designRunId,
        sessionId: input.proposalSet.sessionId,
        rolloutStage: proposal.rolloutStage,
        readinessTarget: proposal.readinessTarget,
        materializedAt: input.materializedAt
      },
      owner: {
        role: proposal.ownerRole
      }
    },
    trigger: {
      type: proposal.trigger.type,
      source: "hermes",
      event: slugify(proposal.routing.problemTypes[0] ?? proposal.trigger.description),
      ...(proposal.trigger.type === "schedule" ? { schedule: proposal.trigger.cadence ?? "@daily" } : {})
    },
    input: {
      schema: inputSchemaForProposal(proposal),
      fixtures: starterFixtureRefsForSpec()
    },
    output: {
      schema: {
        type: "object",
        required: ["summary", "evidence"],
        properties: {
          summary: { type: "string" },
          recommendation: { type: "string" },
          proposedActions: { type: "array", items: { type: "object" } },
          evidence: { type: "array", items: { type: "object" } },
          metrics: { type: "array", items: { type: "object" } },
          requiredHumanDecisions: { type: "array", items: { type: "string" } }
        },
        additionalProperties: true
      }
    },
    context: {
      sources: contextSourcesForProposal(proposal),
      precedence: [
        { sourceType: "policy", rank: 1 },
        { sourceType: "event", rank: 2 },
        { sourceType: "integration", rank: 3 },
        { sourceType: "fixture", rank: 4 },
        { sourceType: "trace", rank: 5 }
      ],
      tokenBudget: 8000,
      redactionPolicy: "restricted_only"
    },
    routine: {
      steps: proposal.routineSteps.map((step, index) => ({
        id: slugify(step.id) || `step_${index + 1}`,
        name: step.label,
        stepType: step.actor === "human" ? "human_review" : step.id,
        actor: step.actor,
        description: step.description
      }))
    },
    tools: proposal.proposedActions.map((action) => ({
      key: action.key,
      adapterId: adapterIdFromAction(action.key),
      label: action.label,
      writeCapable: action.requiresApproval || action.customerFacing || action.riskLevel !== "low",
      riskLevel: action.riskLevel
    })),
    policy: {
      allowedActions,
      forbiddenActions: proposal.forbiddenActions.map((reason, index) => ({
        toolKey: `forbidden_${index + 1}`,
        reason
      })),
      escalationRules: [{
        id: "hermes_human_review_required",
        when: {
          lowConfidence: true,
          missingRequiredConnection: true,
          escalationConditions: proposal.escalationConditions
        },
        createEscalationCase: {
          category: "hermes_loop_materialization",
          severity: "P2"
        },
        routeTo: {
          primaryOwner: proposal.ownerRole,
          reviewers: proposal.reviewerRoles,
          responseSla: "1 business day"
        },
        requiresApproval: allowedActions
          .filter((action) => action.requiresApproval)
          .map((action) => action.toolKey),
        decisionsRequired: [
          "Approve, reject, or request changes before external writes or customer-facing output."
        ]
      }]
    },
    verification: proposal.verifiers.map((verifier, index) => ({
      id: `verifier_${index + 1}`,
      type: verifierType(verifier.type),
      config: {
        description: verifier.description
      }
    })),
    approval: {
      requireFingerprintMatch: true,
      separateCustomerFacingApproval: true,
      allowedRoles: ["owner", "reviewer", "approver"]
    },
    persistence: {
      idempotency: { enabled: true },
      timeout: { seconds: 120 },
      retry: { maxAttempts: 1 }
    },
    trace: {
      captureContextSnapshot: true,
      captureToolInputOutput: true,
      evidenceRequired: true,
      exportOpenTelemetry: false
    },
    topology: {
      ...(proposal.parentLoopId ? { parentLoopId: proposal.parentLoopId } : {}),
      department: proposal.department,
      tags: [
        "hermes",
        proposal.rolloutStage,
        proposal.readinessTarget,
        ...proposal.routing.problemTypes
      ]
    },
    routing: {
      ...proposal.routing,
      requiredConnections: uniqueStrings([
        ...(proposal.routing.requiredConnections ?? []),
        ...proposal.connectorRequirements
          .filter((requirement) => requirement.requiredFor !== "design")
          .map((requirement) => requirement.capability)
      ])
    },
    studioExtension: {
      hermesDesign: {
        schemaVersion: LOOP_MATERIALIZATION_SCHEMA_VERSION,
        designRunId: input.designRunId,
        proposalId: proposal.proposalId,
        sessionId: input.proposalSet.sessionId,
        materializedAt: input.materializedAt,
        goal: proposal.goal,
        businessOutcome: proposal.businessOutcome,
        assumptions: proposal.assumptions,
        openQuestions: proposal.openQuestions,
        evidenceRefs: proposal.evidenceRefs,
        connectorRequirements: proposal.connectorRequirements,
        manualFallbacks: proposal.manualFallbacks,
        requiredFromUser: proposal.requiredFromUser,
        topologyPreview: proposal.topologyPreview,
        metrics: proposal.metrics
      }
    }
  };

  return validateLoopSpec(spec);
}

function materializedLoopFromPrepared(prepared: PreparedMaterialization): MaterializedLoop {
  const routingCard = compileRoutingCardFromLoopSpec(prepared.spec, { catalogVersion: "materialized" });
  if (!routingCard) {
    throw new Error(`Materialized LoopSpec is missing a routing contract: ${prepared.spec.metadata.id}`);
  }
  const starterFixtures = starterFixturePaths(prepared.specPath);
  return {
    proposalId: prepared.proposal.proposalId,
    loopId: prepared.spec.metadata.id,
    name: prepared.spec.metadata.name,
    department: prepared.proposal.department,
    status: prepared.status,
    specPath: prepared.specPath,
    relativeSpecPath: prepared.relativeSpecPath,
    routingCard,
    requiredConnections: prepared.proposal.connectorRequirements,
    requiredFromUser: prepared.proposal.requiredFromUser,
    simulation: {
      needsFixture: true,
      command: `loopgraph simulate ${prepared.specPath} --fixture ${starterFixtures[0].path}`,
      starterFixtures
    }
  };
}

function inputSchemaForProposal(proposal: LoopDesignProposal): Record<string, unknown> {
  const mappedProperties = Object.fromEntries(Object.keys(proposal.routing.inputMapping).map((key) => [
    key,
    { type: "string", description: `Mapped from ${proposal.routing.inputMapping[key]}` }
  ]));
  return {
    type: "object",
    properties: {
      event: {
        type: "object",
        description: "Normalized EventEnvelope received by Hermes and validated by Loopgraph."
      },
      workItem: {
        type: "string",
        description: proposal.workItem
      },
      ...mappedProperties
    },
    additionalProperties: true
  };
}

function contextSourcesForProposal(proposal: LoopDesignProposal): LoopSpec["context"]["sources"] {
  const sources: LoopSpec["context"]["sources"] = [{
    id: "hermes_event",
    type: "event",
    adapterId: "hermes",
    variableKey: "event",
    title: "Hermes normalized event envelope",
    sensitivity: "internal",
    trusted: false,
    precedence: 1
  }];
  proposal.contextSources.forEach((source, index) => {
    sources.push({
      id: `context_${index + 1}_${slugify(source)}`,
      type: "integration",
      adapterId: slugify(source),
      variableKey: slugify(source),
      title: source,
      sensitivity: "internal",
      trusted: true,
      precedence: index + 2
    });
  });
  proposal.manualFallbacks.forEach((fallback, index) => {
    sources.push({
      id: `manual_fallback_${index + 1}`,
      type: "fixture",
      adapterId: "manual",
      variableKey: `manual_fallback_${index + 1}`,
      title: fallback,
      sensitivity: "internal",
      trusted: true,
      precedence: proposal.contextSources.length + index + 2
    });
  });
  return sources;
}

async function existingMaterializationStatus(input: {
  projectRoot: string;
  existing?: RegisteredLoopSpec;
  activeArtifact?: StoredLoopSpecArtifact;
  proposal: LoopDesignProposal;
  designRunId: string;
  expectedSpecPath: string;
}): Promise<"none" | "same" | "conflict"> {
  if (!input.existing) return "none";
  if (input.activeArtifact) {
    const labels = input.activeArtifact.spec.metadata.labels ?? {};
    return labels.source === "hermes-design" &&
      labels.proposalId === input.proposal.proposalId &&
      labels.designRunId === input.designRunId
      ? "same"
      : "conflict";
  }
  const existingPath = path.isAbsolute(input.existing.path)
    ? input.existing.path
    : path.resolve(input.projectRoot, input.existing.path);
  if (path.resolve(existingPath) !== path.resolve(input.expectedSpecPath)) return "conflict";
  if (!await pathExists(existingPath)) return "none";

  const loaded = await loadLoopSpecFromPath(existingPath);
  if (!loaded.ok) return "conflict";
  const labels = loaded.spec.metadata.labels ?? {};
  return labels.source === "hermes-design" &&
    labels.proposalId === input.proposal.proposalId &&
    labels.designRunId === input.designRunId
    ? "same"
    : "conflict";
}

async function registerPreparedSpecs(input: {
  projectRoot: string;
  prepared: PreparedMaterialization[];
  materializedAt: string;
}): Promise<void> {
  const registry = await readLoopgraphWorkspace(input.projectRoot);
  const entriesById = new Map(registry.registeredSpecs.map((entry) => [entry.id, entry]));
  for (const item of input.prepared) {
    entriesById.set(item.spec.metadata.id, {
      id: item.spec.metadata.id,
      name: item.spec.metadata.name,
      path: item.relativeSpecPath,
      templateId: "hermes-design",
      department: item.proposal.department,
      addedAt: entriesById.get(item.spec.metadata.id)?.addedAt ?? input.materializedAt
    });
  }

  await writeLoopgraphWorkspace({
    ...registry,
    registeredSpecs: Array.from(entriesById.values()),
    updatedAt: input.materializedAt
  }, input.projectRoot);
}

async function stageMaterializationTransaction(input: {
  projectRoot: string;
  materializationId: string;
  prepared: PreparedMaterialization[];
  materializedAt: string;
}): Promise<MaterializationTransaction> {
  const loopgraphRoot = getLoopgraphRoot(input.projectRoot);
  const stagingDir = path.join(
    loopgraphRoot,
    "discovery",
    "materializations",
    "staging",
    safeFileName(input.materializationId)
  );
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  const items: MaterializationTransactionItem[] = [];
  try {
    for (const prepared of input.prepared) {
      if (prepared.status === "already_materialized") continue;

      const finalDir = path.dirname(prepared.specPath);
      assertInsideDirectory(loopgraphRoot, finalDir, "materialized LoopSpec target");
      const stagedSpecPath = path.join(
        stagingDir,
        "generated",
        path.relative(path.join(loopgraphRoot, "generated"), prepared.specPath)
      );
      assertInsideDirectory(stagingDir, stagedSpecPath, "staged LoopSpec target");
      const stagedPrepared: PreparedMaterialization = {
        ...prepared,
        specPath: stagedSpecPath
      };

      await writeGeneratedStarterFixtures(stagedPrepared, input.materializedAt);
      await writeLoopSpec(stagedPrepared.specPath, stagedPrepared.spec);

      items.push({
        prepared,
        stagedDir: path.dirname(stagedSpecPath),
        finalDir,
        backupDir: path.join(stagingDir, "backups", safeFileName(prepared.spec.metadata.id)),
        finalExisted: await pathExists(finalDir),
        promoted: false
      });
    }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  return { stagingDir, items };
}

async function promoteMaterializationTransaction(transaction: MaterializationTransaction): Promise<void> {
  for (const item of transaction.items) {
    await mkdir(path.dirname(item.backupDir), { recursive: true });
    await rm(item.backupDir, { recursive: true, force: true });
    if (item.finalExisted) {
      await rename(item.finalDir, item.backupDir);
    }

    await mkdir(path.dirname(item.finalDir), { recursive: true });
    await cp(item.stagedDir, item.finalDir, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    item.promoted = true;
  }
}

async function rollbackMaterializationTransaction(transaction: MaterializationTransaction): Promise<void> {
  for (const item of [...transaction.items].reverse()) {
    if (item.promoted || await pathExists(item.finalDir)) {
      await rm(item.finalDir, { recursive: true, force: true });
    }
    if (item.finalExisted && await pathExists(item.backupDir)) {
      await mkdir(path.dirname(item.finalDir), { recursive: true });
      await rename(item.backupDir, item.finalDir);
    }
  }
  await cleanupMaterializationTransaction(transaction);
}

async function cleanupMaterializationTransaction(transaction: MaterializationTransaction): Promise<void> {
  await rm(transaction.stagingDir, { recursive: true, force: true });
}

async function writeGeneratedStarterFixtures(
  prepared: PreparedMaterialization,
  materializedAt: string
): Promise<void> {
  const fixtureDir = path.join(path.dirname(prepared.specPath), "fixtures");
  await mkdir(fixtureDir, { recursive: true });

  for (const fixture of starterFixturePaths(prepared.specPath)) {
    const data = createStarterFixture({
      proposal: prepared.proposal,
      spec: prepared.spec,
      fixtureId: fixture.id,
      label: fixture.label,
      materializedAt
    });
    await writeFile(fixture.path, `${JSON.stringify(data, null, 2)}\n`);
  }
}

function starterFixtureRefsForSpec(): NonNullable<LoopSpec["input"]["fixtures"]> {
  return STARTER_FIXTURE_DEFINITIONS.map((fixture) => ({
    id: fixture.id,
    path: `fixtures/${fixture.id}.json`
  }));
}

function starterFixturePaths(specPath: string): StarterFixtureRef[] {
  return STARTER_FIXTURE_DEFINITIONS.map((fixture) => ({
    ...fixture,
    path: path.join(path.dirname(specPath), "fixtures", `${fixture.id}.json`),
    relativePath: `fixtures/${fixture.id}.json`
  }));
}

function createStarterFixture(input: {
  proposal: LoopDesignProposal;
  spec: LoopSpec;
  fixtureId: StarterFixtureRef["id"];
  label: string;
  materializedAt: string;
}): Record<string, unknown> {
  const accept = input.proposal.routing.accepts[0];
  const omittedField = input.fixtureId === "missing-context"
    ? accept?.requiredFields[accept.requiredFields.length - 1]
    : undefined;
  const normalizedPayload = payloadForRequiredFields(accept?.requiredFields ?? [], input.fixtureId, omittedField);
  const source = sourceFromPattern(accept?.sourcePattern ?? input.spec.trigger.source);
  const eventType = eventTypeFromPattern(accept?.eventTypePattern ?? input.spec.trigger.event);
  const subjectType = accept?.subjectTypes[0] ?? input.proposal.workItem.toLowerCase().replace(/\s+/g, "_");
  const eventId = `fixture_${safeFileName(input.spec.metadata.id)}_${input.fixtureId}`;

  return {
    eventId,
    simulatedAt: input.materializedAt,
    label: input.label,
    synthetic: true,
    scenario: input.fixtureId,
    loopId: input.spec.metadata.id,
    note: "Synthetic Hermes starter fixture. Replace with redacted real samples before production execution.",
    trigger: {
      id: eventId,
      schemaVersion: "event-envelope/v1alpha1",
      workspaceId: "workspace_local",
      companyId: "company_local",
      source,
      sourceRoute: `hermes.${source}`,
      sourceDeliveryId: eventId,
      eventType,
      occurredAt: input.materializedAt,
      receivedAt: input.materializedAt,
      subject: {
        type: subjectType,
        id: `${safeFileName(subjectType)}_synthetic_1`,
        display: `${input.proposal.shortName} synthetic ${input.fixtureId}`
      },
      correlationId: `corr_${safeFileName(input.spec.metadata.id)}_${input.fixtureId}`,
      normalizedPayload,
      evidenceRefs: [`fixture:${input.fixtureId}:evidence_1`],
      trust: {
        signatureVerified: false,
        signer: "synthetic-fixture",
        untrustedFields: ["normalizedPayload"]
      },
      sensitivity: "internal"
    },
    contextOverrides: {
      hermesDesign: true,
      department: input.proposal.department,
      loopGoal: input.proposal.goal,
      connectorStatus: input.proposal.connectorRequirements.map((requirement) => ({
        capability: requirement.capability,
        status: "manual_fallback",
        requiredFor: requirement.requiredFor,
        reason: requirement.reason
      })),
      requiredFromUser: input.proposal.requiredFromUser,
      missingContext: omittedField ? [{
        field: omittedField,
        reason: "Intentionally omitted by the synthetic missing-context fixture."
      }] : []
    },
    expectedAssessment: expectedAssessmentForFixture(input.proposal, input.fixtureId, omittedField)
  };
}

function payloadForRequiredFields(
  requiredFields: string[],
  fixtureId: StarterFixtureRef["id"],
  omittedField?: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    summary: `Synthetic ${fixtureId} event for local Hermes loop simulation.`,
    fixtureScenario: fixtureId
  };

  for (const field of requiredFields) {
    if (field === omittedField) continue;
    setNestedValue(payload, field, sampleValueForField(field, fixtureId));
  }

  if (omittedField) {
    payload.missingContext = {
      omittedField,
      reason: "Synthetic scenario used to test Hermes escalation and context request behavior."
    };
  }

  return payload;
}

function expectedAssessmentForFixture(
  proposal: LoopDesignProposal,
  fixtureId: StarterFixtureRef["id"],
  omittedField?: string
): AgentRunOutput {
  const preferredAction = preferredActionForFixture(proposal, fixtureId);
  const proposedActions = preferredAction
    ? [{
        id: `act_${slugify(preferredAction.key)}_${fixtureId}`,
        toolKey: preferredAction.key,
        label: preferredAction.label,
        input: {
          synthetic: true,
          scenario: fixtureId,
          recommendation: recommendationForFixture(proposal, fixtureId, omittedField)
        },
        riskLevel: preferredAction.riskLevel,
        requiresApproval: preferredAction.requiresApproval,
        customerFacing: preferredAction.customerFacing
      }]
    : [];

  const escalationRequired = fixtureId !== "happy-path";
  return {
    decisionSummary: decisionSummaryForFixture(proposal, fixtureId, omittedField),
    assumptions: [
      {
        id: "assumption_synthetic_fixture",
        statement: "This assessment is generated from a synthetic Hermes starter fixture for local simulation only.",
        confidence: 1
      },
      {
        id: "assumption_manual_fallbacks",
        statement: "Connector data is represented by manual fallback context until the user connects live systems.",
        confidence: fixtureId === "happy-path" ? 0.86 : 0.62
      }
    ],
    proposedActions,
    evidence: [
      {
        id: "evidence_synthetic_event",
        sourceId: "trigger.normalizedPayload",
        sourceType: "event",
        excerpt: `${proposal.shortName} ${fixtureId} event includes synthetic routing evidence.`,
        trusted: false
      },
      {
        id: "evidence_design_goal",
        sourceId: "studioExtension.hermesDesign.goal",
        sourceType: "policy",
        excerpt: proposal.goal.slice(0, 180),
        trusted: true
      }
    ],
    policyInputs: [
      { key: "confidence", value: fixtureId === "happy-path" ? 0.91 : fixtureId === "missing-context" ? 0.48 : 0.82, source: "synthetic-fixture" },
      { key: "fixture.scenario", value: fixtureId, source: "synthetic-fixture" },
      { key: "loop.department", value: proposal.department, source: "hermes-design" },
      { key: "loop.primaryMetric", value: proposal.metrics.primary, source: "hermes-design" }
    ],
    verificationRequest: {
      required: escalationRequired,
      reason: escalationRequired ? "Synthetic fixture exercises missing-context or risk escalation handling." : undefined,
      checks: escalationRequired ? ["evidence", "policy", "human_review"] : ["evidence"]
    },
    escalationRequest: escalationRequired
      ? {
          required: true,
          category: fixtureId === "missing-context" ? "missing_context" : "risk_review",
          severity: fixtureId === "missing-context" ? "P3" : "P2",
          rationale: fixtureId === "missing-context"
            ? `Hermes needs more context before routing safely${omittedField ? `: ${omittedField}` : "."}`
            : "Synthetic scenario crosses the loop's review or risk boundary."
        }
      : { required: false }
  };
}

function preferredActionForFixture(
  proposal: LoopDesignProposal,
  fixtureId: StarterFixtureRef["id"]
): LoopDesignProposal["proposedActions"][number] | undefined {
  if (fixtureId === "happy-path") {
    return proposal.proposedActions.find((action) =>
      action.riskLevel === "low" &&
      !action.requiresApproval &&
      !action.customerFacing
    ) ?? proposal.proposedActions[0];
  }

  if (fixtureId === "risk-escalation") {
    return proposal.proposedActions.find((action) =>
      action.requiresApproval ||
      action.customerFacing ||
      action.riskLevel === "high" ||
      action.riskLevel === "critical"
    ) ?? proposal.proposedActions[0];
  }

  return undefined;
}

function recommendationForFixture(
  proposal: LoopDesignProposal,
  fixtureId: StarterFixtureRef["id"],
  omittedField?: string
): string {
  if (fixtureId === "missing-context") {
    return omittedField
      ? `Ask the user to provide ${omittedField} before Hermes triggers ${proposal.shortName}.`
      : `Ask the user for the missing business context before Hermes triggers ${proposal.shortName}.`;
  }
  if (fixtureId === "risk-escalation") {
    return `Route ${proposal.shortName} to review because the synthetic event touches a configured risk boundary.`;
  }
  return `Proceed with a low-risk ${proposal.shortName} recommendation using cited synthetic evidence.`;
}

function decisionSummaryForFixture(
  proposal: LoopDesignProposal,
  fixtureId: StarterFixtureRef["id"],
  omittedField?: string
): string {
  if (fixtureId === "missing-context") {
    return omittedField
      ? `${proposal.shortName} cannot be routed safely because ${omittedField} is missing.`
      : `${proposal.shortName} needs additional context before Hermes can route safely.`;
  }
  if (fixtureId === "risk-escalation") {
    return `${proposal.shortName} found a synthetic high-risk condition and should request human review.`;
  }
  return `${proposal.shortName} found a routine synthetic event and prepared a low-risk recommendation.`;
}

function sourceFromPattern(pattern: string): string {
  return safeFileName(pattern.replace(/\*/g, "").replace(/\.+$/g, "") || "manual");
}

function eventTypeFromPattern(pattern: string): string {
  return pattern.replace(/\*/g, "synthetic").replace(/\.+$/g, ".synthetic") || "event.synthetic";
}

function sampleValueForField(field: string, fixtureId: StarterFixtureRef["id"]): unknown {
  const normalized = field.toLowerCase();
  if (normalized.includes("approvedevidencerefs") || normalized.includes("evidence")) {
    return ["fixture:evidence_approved_1"];
  }
  if (normalized.includes("reviewer")) return "Synthetic reviewer";
  if (normalized.includes("spend")) return fixtureId === "risk-escalation" ? 48 : 12;
  if (normalized.includes("cost")) return fixtureId === "risk-escalation" ? 55 : 9;
  if (normalized.includes("pct") || normalized.includes("rate") || normalized.includes("score") || normalized.includes("delta")) {
    return fixtureId === "risk-escalation" ? 42 : 8;
  }
  if (normalized.endsWith("id")) return `${safeFileName(field)}_synthetic_1`;
  return `${field.replace(/[^a-zA-Z0-9]+/g, "_")}_synthetic_value`;
}

function setNestedValue(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return;

  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

async function writeLoopSpec(specPath: string, spec: LoopSpec): Promise<void> {
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${YAML.stringify(spec)}\n`);
  const loaded = await loadLoopSpecFromPath(specPath);
  if (!loaded.ok) {
    throw new Error(`Materialized LoopSpec failed to reload:\n- ${loaded.errors.join("\n- ")}`);
  }
}

function materializedSpecPath(projectRoot: string, proposal: LoopDesignProposal): string {
  return path.join(
    getLoopgraphRoot(projectRoot),
    "generated",
    "hermes",
    proposal.department,
    safeFileName(proposal.loopSpecId),
    "loopgraph.yaml"
  );
}

function materializationFilePath(projectRoot: string, materializationId: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "discovery", "materializations", `${safeFileName(materializationId)}.json`);
}

function graphProjectionFromProposals(proposals: LoopDesignProposal[]): HermesGraphProjection {
  const nodes: HermesGraphProjectionNode[] = [];
  const edges: HermesGraphProjectionEdge[] = [];
  for (const proposal of proposals) {
    if (proposal.topologyPreview.nodes.length > 0) {
      nodes.push(...proposal.topologyPreview.nodes);
      edges.push(...proposal.topologyPreview.edges);
    } else {
      const departmentId = `department:${proposal.department}`;
      nodes.push(
        { id: "company_brain", label: "Hermes Brain", type: "company_brain" },
        { id: departmentId, label: formatDepartmentType(proposal.department), type: "department" },
        { id: `loop:${proposal.loopSpecId}`, label: proposal.shortName, type: "loop" }
      );
      edges.push(
        { source: "company_brain", target: departmentId, label: "routes business problems", executable: false },
        { source: departmentId, target: `loop:${proposal.loopSpecId}`, label: "workflow loop", executable: false }
      );
    }
  }
  return dedupeGraphProjection({ nodes, edges });
}

function dedupeGraphProjection(projection: HermesGraphProjection): HermesGraphProjection {
  const nodes = Array.from(new Map(projection.nodes.map((node) => [node.id, node])).values());
  const edges = Array.from(new Map(projection.edges.map((edge) => [
    `${edge.source}->${edge.target}:${edge.label}`,
    edge
  ])).values());
  return { nodes, edges };
}

function nextActionsForMaterializedLoops(loops: MaterializedLoop[]): string[] {
  const connections = uniqueStrings(loops.flatMap((loop) => loop.requiredConnections.map((item) => item.capability)));
  const actions = [
    "Open the local graph and confirm Hermes Brain routes into the selected department loops.",
    "Run the generated loops in simulation with redacted fixtures before enabling live writes."
  ];
  if (connections.length > 0) {
    actions.unshift(`Connect or provide manual fallback data for: ${connections.join(", ")}.`);
  }
  return actions;
}

function workspaceSummary(workspace: Awaited<ReturnType<typeof inspectLoopgraphWorkspace>>): LoopMaterializationResult["workspace"] {
  return {
    registeredSpecCount: workspace.registeredSpecCount,
    registeredDepartments: workspace.registeredDepartments,
    routingReadySpecCount: workspace.routingReadySpecCount
  };
}

async function readMaterializationWorkspace(
  projectRoot: string,
  store?: LoopSpecRegistryStore
): Promise<LoopMaterializationResult["workspace"]> {
  if (!store) {
    return workspaceSummary(
      await inspectLoopgraphWorkspace({ projectRoot })
    );
  }
  const [workspace, artifacts] = await Promise.all([
    store.getWorkspace(projectRoot),
    store.listActiveLoopSpecs(projectRoot)
  ]);
  return workspaceSummaryFromArtifacts(workspace.workspace, artifacts);
}

function workspaceSummaryFromArtifacts(
  workspace: LoopgraphWorkspaceRegistry,
  artifacts: StoredLoopSpecArtifact[]
): LoopMaterializationResult["workspace"] {
  return {
    registeredSpecCount: workspace.registeredSpecs.length,
    registeredDepartments: uniqueStrings(
      workspace.registeredSpecs.map((entry) => entry.department)
    ),
    routingReadySpecCount: artifacts.filter((artifact) =>
      Boolean(
        compileRoutingCardFromLoopSpec(artifact.spec, {
          catalogVersion: "workspace"
        })
      )
    ).length
  };
}

async function appendMaterializedLoopsToDiscoverySession(input: {
  projectRoot: string;
  store?: DiscoveryDesignStore;
  sessionId: string;
  loopIds: string[];
  actor: DiscoveryActor;
  materializedAt: string;
}): Promise<void> {
  const session = await getDiscoverySession(
    input.sessionId,
    input.projectRoot,
    input.store
  );
  if (!session) return;
  const next = BusinessDiscoverySessionSchema.parse({
    ...session,
    status: "completed",
    activeStage: "materialization",
    createdLoopIds: uniqueStrings([...session.createdLoopIds, ...input.loopIds]),
    revision: session.revision + 1,
    lastActor: input.actor,
    lastTransitionAt: input.materializedAt,
    updatedAt: input.materializedAt
  });
  await saveDiscoverySession(next, input.projectRoot, {
    store: input.store,
    expectedRevision: session.revision
  });
}

function normalizeDiscoveryActor(value?: string): DiscoveryActor {
  if (value === "browser" || value === "hermes" || value === "cli" || value === "api") return value;
  return "api";
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assertInsideDirectory(rootDir: string, targetPath: string, label: string): void {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the Loopgraph workspace: ${targetPath}`);
  }
}

function verifierType(type: LoopDesignProposal["verifiers"][number]["type"]): LoopSpec["verification"][number]["type"] {
  if (type === "numeric") return "numeric_threshold";
  if (type === "human_review") return "approval_required";
  if (type === "custom") return "mock_judge";
  return type;
}

function adapterIdFromAction(actionKey: string): string {
  if (actionKey.includes(".")) return actionKey.split(".")[0] || "manual";
  return "manual";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "loop";
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
