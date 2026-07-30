import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  MetricDefinitionSchema,
  evidenceTruthStatusSchema,
  measurementWindowSchema,
  metricSampleQualityStatusSchema,
  metricSampleSourceTypeSchema,
  outcomeStatusSchema,
  type LoopRunTrace,
  type MetricDefinition
} from "../core";
import { FileStorageAdapter } from "../sdk/storage";
import {
  deriveLoopValueLedgerEntry,
  evaluateObservedOutcome,
  recordMetricSample,
  recordValueLedgerEntry
} from "./outcome-service";
import { FileOutcomeStore } from "./outcome-store";
import { getLoopgraphRoot } from "./storage-resolver";
import { readLoopgraphWorkspace } from "./workspace";

export const LOOPGRAPH_OUTCOME_TOOL_NAMES = [
  "loopgraph_metric_samples_ingest",
  "loopgraph_metric_samples_get",
  "loopgraph_outcomes_evaluate",
  "loopgraph_outcomes_get",
  "loopgraph_value_ledger_record",
  "loopgraph_value_ledger_get"
] as const;

export type LoopgraphOutcomeToolName = (typeof LOOPGRAPH_OUTCOME_TOOL_NAMES)[number];

export type LoopgraphOutcomeToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

const hiddenCostMinutesSchema = z.object({
  review: z.number().min(0).optional(),
  rework: z.number().min(0).optional(),
  botsitting: z.number().min(0).optional(),
  escalation: z.number().min(0).optional(),
  governance: z.number().min(0).optional()
}).default({});

export const metricSampleIngestInputSchema = z.object({
  projectRoot: z.string().optional(),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  metricDefinitionId: z.string().min(1),
  metricKey: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1).max(64),
  window: measurementWindowSchema,
  observedAt: z.string().datetime(),
  source: z.object({
    type: metricSampleSourceTypeSchema,
    sourceRef: z.string().min(1).max(512),
    connectorInstanceId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    reviewId: z.string().min(1).optional()
  }),
  quality: z.object({
    status: metricSampleQualityStatusSchema,
    reason: z.string().min(1).max(1000).optional(),
    freshnessDeadline: z.string().datetime().optional()
  }),
  truthStatus: evidenceTruthStatusSchema.optional(),
  evidenceRefs: z.array(z.string().min(1).max(512)).max(100).default([])
});

export const metricSamplesGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  sampleId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  metricDefinitionId: z.string().min(1).optional(),
  metricKey: z.string().min(1).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional()
}).default({});

export const outcomesEvaluateInputSchema = z.object({
  projectRoot: z.string().optional(),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1),
  metricDefinitionId: z.string().min(1),
  baselineWindow: measurementWindowSchema,
  evaluationWindow: measurementWindowSchema,
  desiredDirection: z.enum(["increase", "decrease", "target", "maintain"]).optional(),
  minimumBaselineSamples: z.number().int().min(1).max(1000).default(1),
  minimumObservedSamples: z.number().int().min(1).max(1000).default(1),
  tolerancePct: z.number().min(0).max(100).default(1),
  runIds: z.array(z.string().min(1)).max(100).default([]),
  problemIds: z.array(z.string().min(1)).max(100).default([])
});

export const outcomesGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  outcomeId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  metricDefinitionId: z.string().min(1).optional(),
  status: outcomeStatusSchema.optional()
}).default({});

export const valueLedgerRecordInputSchema = z.object({
  projectRoot: z.string().optional(),
  mode: z.enum(["record", "derive"]).default("record"),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1),
  window: measurementWindowSchema,
  metricDefinitionId: z.string().min(1).optional(),
  outcomeId: z.string().min(1).optional(),
  grossSavedMinutes: z.number().min(0).optional(),
  modeledGrossSavedMinutes: z.number().min(0).optional(),
  hiddenCostMinutes: hiddenCostMinutesSchema,
  observedOutcomeIds: z.array(z.string().min(1)).max(100).default([]),
  runIds: z.array(z.string().min(1)).max(100).default([]),
  reviewIds: z.array(z.string().min(1)).max(100).default([]),
  evidenceRefs: z.array(z.string().min(1).max(512)).max(200).default([]),
  monetaryValue: z.object({
    currency: z.string().length(3),
    grossAmount: z.number().min(0),
    observedCostAmount: z.number().min(0)
  }).optional()
}).superRefine((input, context) => {
  if (input.mode === "derive" && (!input.metricDefinitionId || !input.outcomeId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "metricDefinitionId and outcomeId are required when mode=derive",
      path: ["mode"]
    });
  }
  if (
    input.mode === "record" &&
    input.grossSavedMinutes === undefined &&
    input.modeledGrossSavedMinutes === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "grossSavedMinutes or modeledGrossSavedMinutes is required when mode=record",
      path: ["grossSavedMinutes"]
    });
  }
});

export const valueLedgerGetInputSchema = z.object({
  projectRoot: z.string().optional(),
  entryId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  loopId: z.string().min(1).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional()
}).default({});

export const loopgraphOutcomeToolDefinitions = [
  {
    name: "loopgraph_metric_samples_ingest",
    description: "Record one project-bound metric sample with source quality and evidence truth.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_metric_samples_get",
    description: "Read project-bound metric samples and their evidence quality.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_outcomes_evaluate",
    description: "Evaluate a baseline and measurement window without inventing missing outcome evidence.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_outcomes_get",
    description: "Read observed, modeled, or incomplete business outcomes.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_value_ledger_record",
    description: "Record or derive net loop value after review, rework, botsitting, escalation, and governance cost.",
    readOnly: false,
    idempotent: true
  },
  {
    name: "loopgraph_value_ledger_get",
    description: "Read the project-bound loop value ledger and evidence truth.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphOutcomeToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphOutcomeTool(
  name: LoopgraphOutcomeToolName,
  input: unknown,
  options: LoopgraphOutcomeToolRuntimeOptions = {}
) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const workspace = await readLoopgraphWorkspace(projectRoot);
  const store = new FileOutcomeStore(getLoopgraphRoot(projectRoot));

  if (name === "loopgraph_metric_samples_ingest") {
    const parsed = metricSampleIngestInputSchema.parse(input);
    return recordMetricSample(store, {
      companyId: parsed.companyId,
      workspaceId: workspace.projectRootId,
      departmentId: parsed.departmentId,
      loopId: parsed.loopId,
      metricDefinitionId: parsed.metricDefinitionId,
      metricKey: parsed.metricKey,
      value: parsed.value,
      unit: parsed.unit,
      window: parsed.window,
      observedAt: parsed.observedAt,
      source: parsed.source,
      quality: parsed.quality,
      truthStatus: parsed.truthStatus,
      evidenceRefs: parsed.evidenceRefs
    }, options.now);
  }
  if (name === "loopgraph_metric_samples_get") {
    const parsed = metricSamplesGetInputSchema.parse(input);
    if (parsed.sampleId) return { sample: await store.getMetricSample(parsed.sampleId) };
    return {
      samples: await store.listMetricSamples({
        workspaceId: workspace.projectRootId,
        companyId: parsed.companyId,
        departmentId: parsed.departmentId,
        loopId: parsed.loopId,
        metricDefinitionId: parsed.metricDefinitionId,
        metricKey: parsed.metricKey,
        windowStart: parsed.windowStart,
        windowEnd: parsed.windowEnd
      })
    };
  }
  if (name === "loopgraph_outcomes_evaluate") {
    const parsed = outcomesEvaluateInputSchema.parse(input);
    const metricDefinition = await requireMetricDefinition(projectRoot, parsed.metricDefinitionId);
    return evaluateObservedOutcome({
      store,
      workspaceId: workspace.projectRootId,
      companyId: parsed.companyId,
      departmentId: parsed.departmentId,
      loopId: parsed.loopId,
      metricDefinition,
      baselineWindow: parsed.baselineWindow,
      evaluationWindow: parsed.evaluationWindow,
      desiredDirection: parsed.desiredDirection,
      minimumBaselineSamples: parsed.minimumBaselineSamples,
      minimumObservedSamples: parsed.minimumObservedSamples,
      tolerancePct: parsed.tolerancePct,
      runIds: parsed.runIds,
      problemIds: parsed.problemIds,
      now: options.now
    });
  }
  if (name === "loopgraph_outcomes_get") {
    const parsed = outcomesGetInputSchema.parse(input);
    if (parsed.outcomeId) return { outcome: await store.getObservedOutcome(parsed.outcomeId) };
    return {
      outcomes: await store.listObservedOutcomes({
        workspaceId: workspace.projectRootId,
        companyId: parsed.companyId,
        departmentId: parsed.departmentId,
        loopId: parsed.loopId,
        metricDefinitionId: parsed.metricDefinitionId,
        status: parsed.status
      })
    };
  }
  if (name === "loopgraph_value_ledger_record") {
    const parsed = valueLedgerRecordInputSchema.parse(input);
    if (parsed.mode === "derive") {
      const metricDefinition = await requireMetricDefinition(projectRoot, parsed.metricDefinitionId!);
      return deriveLoopValueLedgerEntry({
        store,
        workspaceId: workspace.projectRootId,
        companyId: parsed.companyId,
        departmentId: parsed.departmentId,
        loopId: parsed.loopId,
        metricDefinition,
        outcomeId: parsed.outcomeId!,
        traces: await loadTraces(projectRoot, parsed.loopId, parsed.runIds),
        window: parsed.window,
        now: options.now
      });
    }
    return recordValueLedgerEntry({
      store,
      workspaceId: workspace.projectRootId,
      companyId: parsed.companyId,
      departmentId: parsed.departmentId,
      loopId: parsed.loopId,
      window: parsed.window,
      grossSavedMinutes: parsed.grossSavedMinutes,
      modeledGrossSavedMinutes: parsed.modeledGrossSavedMinutes,
      hiddenCostMinutes: parsed.hiddenCostMinutes,
      observedOutcomeIds: parsed.observedOutcomeIds,
      runIds: parsed.runIds,
      reviewIds: parsed.reviewIds,
      evidenceRefs: parsed.evidenceRefs,
      monetaryValue: parsed.monetaryValue,
      now: options.now
    });
  }
  if (name === "loopgraph_value_ledger_get") {
    const parsed = valueLedgerGetInputSchema.parse(input);
    if (parsed.entryId) return { entry: await store.getValueLedgerEntry(parsed.entryId) };
    return {
      entries: await store.listValueLedgerEntries({
        workspaceId: workspace.projectRootId,
        companyId: parsed.companyId,
        departmentId: parsed.departmentId,
        loopId: parsed.loopId,
        windowStart: parsed.windowStart,
        windowEnd: parsed.windowEnd
      })
    };
  }
  throw new Error(`Unknown Loopgraph outcome tool: ${String(name)}`);
}

async function requireMetricDefinition(projectRoot: string, metricDefinitionId: string): Promise<MetricDefinition> {
  const definitions = await readProjectMetricDefinitions(projectRoot);
  const definition = definitions.find((item) => item.id === metricDefinitionId);
  if (!definition) throw new Error(`Metric definition not found: ${metricDefinitionId}`);
  return definition;
}

export async function readProjectMetricDefinitions(projectRoot: string): Promise<MetricDefinition[]> {
  const directory = path.join(getLoopgraphRoot(projectRoot), "metrics");
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const definitions: MetricDefinition[] = [];
    for (const file of files) {
      try {
        definitions.push(MetricDefinitionSchema.parse(JSON.parse(
          await readFile(path.join(directory, file), "utf8")
        )));
      } catch {
        // A malformed record cannot participate in outcome evaluation.
      }
    }
    return definitions;
  } catch {
    return [];
  }
}

async function loadTraces(
  projectRoot: string,
  loopId: string,
  requestedRunIds: string[]
): Promise<LoopRunTrace[]> {
  const storage = new FileStorageAdapter(getLoopgraphRoot(projectRoot));
  const runIds = requestedRunIds.length > 0
    ? requestedRunIds
    : (await storage.listRuns()).filter((run) => run.loopId === loopId).map((run) => run.id);
  const traces = await Promise.all(runIds.map((runId) => storage.getRun(runId)));
  return traces.filter((trace): trace is LoopRunTrace => Boolean(trace && trace.loopId === loopId));
}
