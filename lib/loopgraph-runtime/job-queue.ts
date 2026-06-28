import type { LoopRunTrace } from "../loopgraph-core/trace";

export type PendingJob = {
  id: string;
  runId: string;
  type: "resume_after_review" | "scheduled_loop";
  scheduledFor: string;
  payload: Record<string, unknown>;
};

const queue: PendingJob[] = [];

export function enqueueJob(job: PendingJob) {
  queue.push(job);
  return job;
}

export function listJobs() {
  return [...queue];
}

export function dequeueDueJobs(now = new Date()) {
  const due = queue.filter((job) => new Date(job.scheduledFor) <= now);
  return due;
}

export function scheduleResumeAfterReview(trace: LoopRunTrace, delayMs = 0) {
  return enqueueJob({
    id: `job_resume_${trace.id}`,
    runId: trace.id,
    type: "resume_after_review",
    scheduledFor: new Date(Date.now() + delayMs).toISOString(),
    payload: { status: trace.status }
  });
}
