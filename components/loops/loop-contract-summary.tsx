import React from "react";
import { titleCase } from "../../lib/loop-engineering-builder/demo-helpers";
import type { LoopRecord, WorkspaceData } from "../../lib/loop-engineering-builder/types";

export function LoopContractSummary({
  loop,
  workspace
}: {
  loop: LoopRecord;
  workspace: WorkspaceData;
}) {
  return (
    <aside className="rounded-lg border border-line bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Contract</div>
      <h3 className="mt-2 text-lg font-semibold">{loop.name}</h3>
      <div className="mt-4 grid gap-3 text-sm">
        <Fact label="Status" value={titleCase(loop.status)} />
        <Fact label="Owner" value={loop.owner} />
        <Fact label="Autonomy" value={titleCase(loop.autonomyLevel)} />
        <Fact label="Cadence" value={loop.cadence} />
        <Fact label="Questions" value={`${workspace.progress.percent}% complete`} />
        <Fact label="Open reviews" value={String(loop.openReviews)} />
        <Fact label="Missing access" value={loop.status === "missing_access" ? "Yes" : "No"} />
        <Fact label="Primary metric" value={loop.targetMetric} />
      </div>
    </aside>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line pb-3 last:border-b-0 last:pb-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/40">{label}</div>
      <div className="mt-1 font-medium text-ink">{value}</div>
    </div>
  );
}
