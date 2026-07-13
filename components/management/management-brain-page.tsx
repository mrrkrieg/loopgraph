import React from "react";
import { MetricCard } from "../metric-card";
import { PageHeader } from "../page-header";
import { SectionCard } from "../section-card";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { DepartmentManagementCard } from "./department-management-card";
import { EventRoutingTable } from "./event-routing-table";

export async function ManagementBrainPage() {
  const workspace = await getWorkspace();
  const departments = Array.from(new Set(workspace.loops.map((loop) => loop.department))).filter(
    (department) => department !== "management"
  );
  const openReviews = workspace.loops.reduce((sum, loop) => sum + loop.openReviews, 0);
  const blockedLoops = workspace.loops.filter((loop) => loop.status === "blocked" || loop.status === "missing_access").length;

  return (
    <>
      <PageHeader
        title="Management"
        description="The company brain receives events, routes work to department management loops, and keeps human owners accountable for approvals, blockers, and metrics."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Events received today" value={workspace.loops.length} note="Demo event stream" />
        <MetricCard label="Open escalations" value={workspace.managementReview.decisions.length} note="Needs management decision" />
        <MetricCard label="Waiting approval" value={openReviews} note="Human judgment required" />
        <MetricCard label="Undefined metrics" value={workspace.metrics.length ? 0 : 1} note="Measurement gaps" />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="Company Brain Overview">
          <p className="text-sm leading-6 text-ink/70">
            Company Brain listens for events, checks policy and context, calls the right department management loop, and records decisions back into Loopgraph.
          </p>
          <div className="mt-4 grid gap-3 text-sm">
            <FlowStep title="Event Intake" body="Company events, department rollups, escalations, and failed verifications enter the management layer." />
            <FlowStep title="Routing Rules" body="Events are routed by type, risk, department, owner, and required autonomy level." />
            <FlowStep title="Human Governance" body="Approvals, policy exceptions, and customer-facing actions stay accountable to named owners." />
          </div>
        </SectionCard>
        <SectionCard title="Routing Rules">
          <div className="overflow-x-auto">
            <EventRoutingTable />
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
