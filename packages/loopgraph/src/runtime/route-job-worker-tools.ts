import path from "node:path";
import { z } from "zod";
import {
  cancelRouteJob,
  FileRoutingStore,
  retryRouteJob
} from "./routing-store";
import { runRouteJobWorker } from "./route-job-worker";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_ROUTE_JOB_WORKER_TOOL_NAMES = [
  "loopgraph_route_worker_run",
  "loopgraph_route_job_retry",
  "loopgraph_route_job_cancel"
] as const;

export type LoopgraphRouteJobWorkerToolName =
  (typeof LOOPGRAPH_ROUTE_JOB_WORKER_TOOL_NAMES)[number];

export const routeWorkerRunInputSchema = z.object({
  projectRoot: z.string().optional(),
  workerId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(10),
  leaseSeconds: z.number().int().min(30).max(3600).default(300)
}).default({});

export const routeJobRetryInputSchema = z.object({
  projectRoot: z.string().optional(),
  jobId: z.string().min(1),
  requestedBy: z.string().min(1),
  reason: z.string().min(1)
});

export const routeJobCancelInputSchema = z.object({
  projectRoot: z.string().optional(),
  jobId: z.string().min(1),
  cancelledBy: z.string().min(1),
  reason: z.string().min(1)
});

export const loopgraphRouteJobWorkerToolDefinitions = [
  {
    name: "loopgraph_route_worker_run",
    description: "Atomically claim due Hermes route jobs, enforce immutable LoopSpec and activation gates, run governed loops, and persist signed lifecycle evidence."
  },
  {
    name: "loopgraph_route_job_retry",
    description: "Explicitly requeue one failed or dead-letter route job with a durable operator reason."
  },
  {
    name: "loopgraph_route_job_cancel",
    description: "Cancel one non-completed route job and record the operator and reason."
  }
] as const;

export type RouteJobWorkerToolRuntimeOptions = {
  projectRoot?: string;
  now?: Date;
};

export async function callLoopgraphRouteJobWorkerTool(
  name: LoopgraphRouteJobWorkerToolName,
  input: unknown,
  options: RouteJobWorkerToolRuntimeOptions = {}
) {
  if (name === "loopgraph_route_worker_run") {
    const parsed = routeWorkerRunInputSchema.parse(input);
    return runRouteJobWorker({
      projectRoot: resolveProjectRoot(parsed.projectRoot, options.projectRoot),
      workerId: parsed.workerId,
      limit: parsed.limit,
      leaseSeconds: parsed.leaseSeconds,
      now: options.now
    });
  }

  if (name === "loopgraph_route_job_retry") {
    const parsed = routeJobRetryInputSchema.parse(input);
    const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
    return {
      schemaVersion: "route-job-operator-action/v1alpha1",
      action: "retry",
      job: await retryRouteJob({
        store: new FileRoutingStore(getLoopgraphRoot(projectRoot)),
        jobId: parsed.jobId,
        requestedBy: parsed.requestedBy,
        reason: parsed.reason,
        now: options.now
      })
    };
  }

  const parsed = routeJobCancelInputSchema.parse(input);
  const projectRoot = resolveProjectRoot(parsed.projectRoot, options.projectRoot);
  return {
    schemaVersion: "route-job-operator-action/v1alpha1",
    action: "cancel",
    job: await cancelRouteJob({
      store: new FileRoutingStore(getLoopgraphRoot(projectRoot)),
      jobId: parsed.jobId,
      cancelledBy: parsed.cancelledBy,
      reason: parsed.reason,
      now: options.now
    })
  };
}

function resolveProjectRoot(inputRoot?: string, optionRoot?: string): string {
  return path.resolve(inputRoot ?? optionRoot ?? process.cwd());
}
