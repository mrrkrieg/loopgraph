import React from "react";
import { titleCase } from "@/lib/loop-engineering-builder/demo-helpers";
import type { DepartmentKey, LoopRecord } from "@/lib/loop-engineering-builder/types";
import { StatusPill } from "../status-pill";

export function DepartmentManagementCard({
  department,
  loops
}: {
  department: DepartmentKey;
  loops: LoopRecord[];
}) {
  const openReviews = loops.reduce((sum, loop) => sum + loop.openReviews, 0);
  const blockedLoops = loops.filter((loop) => loop.status === "blocked" || loop.status === "missing_access").length;
  const primaryGoal = loops[0]?.businessOutcome ?? "Keep department loops accountable to evidence.";

  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{departmentLabel(department)}</h3>
          <p className="mt-1 text-sm text-ink/55">{loops.length} managed loops</p>
        </div>
        <StatusPill>{blockedLoops > 0 ? "needs attention" : "ready"}</StatusPill>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Fact label="Open reviews" value={openReviews} />
        <Fact label="Blocked loops" value={blockedLoops} />
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/65">{primaryGoal}</p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-paper px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function departmentLabel(department: DepartmentKey) {
  if (department === "operations_finance") return "Ops / Finance Department Loop";
  if (department === "hr") return "HR / Talent Department Loop";
  if (department === "legal_security") return "Legal / Compliance Department Loop";
  return `${titleCase(department)} Department Loop`;
}
