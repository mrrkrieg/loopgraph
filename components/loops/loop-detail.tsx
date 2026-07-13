import React from "react";
import Link from "next/link";
import { titleCase } from "../../lib/loop-engineering-builder/demo-helpers";
import type { WorkspaceData } from "../../lib/loop-engineering-builder/types";

const detailTabs = [
  "Overview",
  "Trigger",
  "Data",
  "Routine",
  "Actions",
  "Verifier",
  "Human Review",
  "Metrics",
  "Runs"
];

export function LoopDetail({ workspace }: { workspace: WorkspaceData }) {
  const { loop, spec } = workspace;

  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <div className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">
            {titleCase(loop.department)} workflow loop
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{loop.name}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">{loop.goal}</p>
        </div>
        <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href={`/loops/${loop.id}`}>
          Open loop
        </Link>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {detailTabs.map((tab, index) => (
          <span
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold ${
              index === 0 ? "border-ink bg-ink text-white" : "border-line bg-white text-ink/60"
            }`}
            key={tab}
          >
            {tab}
          </span>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <DetailBlock title="Purpose" body={spec.goal} />
        <DetailBlock title="Trigger" body={spec.trigger} />
        <DetailBlock title="Data" body={spec.dataSources.map((source) => source.name).join(", ") || "No data source configured"} />
        <DetailBlock title="Allowed actions" body={spec.routine.map((step) => step.toolRequired ?? step.stepName).slice(0, 5).join(", ") || "No tool action configured"} />
        <DetailBlock title="Verifier" body={spec.verification.map((item) => item.name).join(", ") || "No verifier configured"} />
        <DetailBlock title="Human review" body={spec.humanOwner || loop.owner} />
        <DetailBlock title="Metrics" body={spec.metrics.map((metric) => metric.name).join(", ") || loop.targetMetric} />
        <DetailBlock title="Runs" body={loop.lastRunAt ? `Last run ${loop.lastRunAt}` : "No run recorded"} />
      </div>
    </section>
  );
}

function DetailBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-line bg-paper p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">{title}</div>
      <p className="mt-2 text-sm leading-6 text-ink/70">{body}</p>
    </div>
  );
}
