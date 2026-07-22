import React from "react";
import Link from "next/link";
import { loadEventRoutingOperations, type EventRoutingOperationsFilters } from "loopgraph/runtime";
import { MetricCard } from "../metric-card";
import { PageHeader } from "../page-header";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { loadLatestManagementRollup } from "@/lib/loopgraph-runtime/management-rollup";
import { getActiveLoopgraphProjectRoot, getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import { DepartmentManagementCard } from "./department-management-card";
import { EventRoutingTable } from "./event-routing-table";

type ManagementBrainPageProps = {
  routingQuery?: EventRoutingOperationsFilters & {
    limit?: number;
  };
};

export async function ManagementBrainPage({ routingQuery = {} }: ManagementBrainPageProps = {}) {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const workspace = await getWorkspace();
  const storage = getStorageAdapter();
  const cases = await storage.listCases();
  const rollup = await loadLatestManagementRollup();
  const routingOperations = await loadEventRoutingOperations({ projectRoot, ...routingQuery });
  const departments = Array.from(new Set(workspace.loops.map((loop) => loop.department))).filter(
    (department) => department !== "management"
  );
  const openReviews = workspace.loops.reduce((sum, loop) => sum + loop.openReviews, 0);
  const openEscalations = cases.filter((item) => item.status === "open").length || workspace.managementReview.decisions.length;
  const blockedLoops = workspace.loops.filter((loop) => loop.status === "blocked" || loop.status === "missing_access").length;

  return (
    <>
      <PageHeader
        title="Management"
        description="Hermes Brain receives business events, chooses the right Loopgraph loop, and keeps human owners accountable for approvals, blockers, and metrics."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Hermes events" value={routingOperations.summary.eventCount} note="Durable routing receipts" />
        <MetricCard label="Open escalations" value={openEscalations} note="Cases and management decisions" />
        <MetricCard label="Waiting approval" value={openReviews} note="Human judgment required" />
        <MetricCard label="Unhandled problems" value={routingOperations.summary.unhandledProblemCount} note="Missing or unmatched loops" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Company Brain Overview">
          <p className="text-sm leading-6 text-ink/70">
            Hermes Brain listens for events, asks Loopgraph for eligible routing cards, chooses the right loop, and records every decision back into Loopgraph.
          </p>
          <div className="mt-4 grid gap-3 text-sm">
            <FlowStep title="Hermes event intake" body="Provider webhooks, lifecycle callbacks, schedules, and manual events terminate at Hermes before any loop can run." />
            <FlowStep title="Bounded routing" body="Hermes receives a normalized envelope and Loopgraph routing cards, then Loopgraph validates the selected route before queueing work." />
            <FlowStep title="Human Governance" body="Approvals, policy exceptions, and customer-facing actions stay accountable to named owners." />
          </div>
        </SectionCard>
        <SectionCard title="Hermes Routing Operations">
          <div className="overflow-x-auto">
            <EventRoutingTable model={routingOperations} />
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="Department Management Loops" description="Each department loop manages specific workflow loops and rolls evidence back into the company brain.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {departments.map((department) => (
              <DepartmentManagementCard
                department={department}
                key={department}
                loops={workspace.loops.filter((loop) => loop.department === department)}
              />
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Weekly management summary"
          description={rollup ? `Persisted rollup ${rollup.weekKey}` : "Run the management cron or simulate escalation cases to populate rollup data."}
        >
          <p className="text-sm leading-6 text-ink/70">{workspace.managementReview.summary}</p>
          {rollup ? <p className="mt-2 text-xs text-ink/50">Generated {rollup.generatedAt}</p> : null}
        </SectionCard>
        <SectionCard title="Decisions needed">
          <div className="space-y-2">
            {workspace.managementReview.decisions.map((item) => (
              <div key={item} className="rounded-md border border-line bg-white px-3 py-2 text-sm">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Human Governance">
          <div className="space-y-2 text-sm leading-6 text-ink/70">
            <p>Customer-facing actions require separate approval.</p>
            <p>Policy exceptions create accountable review work instead of silent execution.</p>
            <p>Escalations keep owner, deadline, confidence, and unresolved questions attached.</p>
          </div>
        </SectionCard>
        <SectionCard title="Management Metrics">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Blocked loops" value={blockedLoops} />
            <MetricCard label="Decision latency" value="1d" />
            <MetricCard label="Unresolved deps" value={workspace.managementReview.bottlenecks.length} />
          </div>
        </SectionCard>
        <SectionCard title="Improvement items">
          <div className="space-y-2">
            {workspace.improvements.length === 0 ? (
              <p className="text-sm text-ink/60">Reject a review or resolve a case via CLI to create improvement signals.</p>
            ) : (
              workspace.improvements.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 text-sm">
                  <div>
                    <div>{item.title}</div>
                    {item.sourceRunId ? (
                      <Link href={`/loops/${item.loopId}/runs/${item.sourceRunId}`} className="text-xs text-ink/50 hover:text-ink">
                        Source run {item.sourceRunId}
                      </Link>
                    ) : null}
                  </div>
                  <StatusPill>{item.status}</StatusPill>
                </div>
              ))
            )}
          </div>
        </SectionCard>
        <SectionCard title="Escalation cases" description="Persisted cases from CLI simulate runs in .loopgraph/cases/">
          {cases.length === 0 ? (
            <p className="text-sm text-ink/60">Run `npm run loopgraph -- simulate ...` to create typed escalation cases.</p>
          ) : (
            <div className="space-y-2">
              {cases.map((item) => (
                <Link
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-paper"
                  href={`/cases/${item.id}`}
                  key={item.id}
                >
                  <span>{item.id}</span>
                  <div className="flex items-center gap-2">
                    <StatusPill>{item.severity}</StatusPill>
                    <StatusPill>{item.status}</StatusPill>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
        {rollup && rollup.plans.length > 0 ? (
          <SectionCard title="Latest management plans" description="From persisted rollup in .loopgraph/management/latest.json">
            <div className="space-y-3">
              {rollup.plans.map((plan) => (
                <div key={plan.caseId} className="rounded-md border border-line bg-white p-3 text-sm">
                  <div className="font-medium">{plan.summary}</div>
                  <div className="mt-1 text-xs text-ink/50">
                    {plan.severity} ·{" "}
                    <Link href={`/cases/${plan.caseId}`} className="hover:text-ink">
                      {plan.caseId}
                    </Link>
                  </div>
                  <pre className="mt-2 overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(plan.plan, null, 2)}</pre>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}
      </div>
    </>
  );
}

function FlowStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 text-ink/60">{body}</p>
    </div>
  );
}
