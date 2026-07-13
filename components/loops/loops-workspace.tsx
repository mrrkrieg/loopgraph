import React from "react";
import Link from "next/link";
import { PageHeader } from "../page-header";
import { titleCase } from "../../lib/loop-engineering-builder/demo-helpers";
import { getDepartmentTemplates } from "../../lib/loop-engineering-builder/templates";
import type { WorkspaceData } from "../../lib/loop-engineering-builder/types";
import { DepartmentFilterBar, type DepartmentFilterOption } from "./department-filter-bar";
import { LoopContractSummary } from "./loop-contract-summary";
import { LoopDetail } from "./loop-detail";
import { LoopList } from "./loop-list";

export function LoopsWorkspace({
  workspace,
  department = "all",
  status = "all"
}: {
  workspace: WorkspaceData;
  department?: string;
  status?: string;
}) {
  const departments = buildDepartmentOptions(workspace);
  const filteredLoops = workspace.loops.filter((loop) => {
    const departmentMatches = department === "all" || loop.department === department;
    const statusMatches = status === "all" || loop.status === status;
    return departmentMatches && statusMatches;
  });
  const selectedLoop = workspace.loop;
  const hasVisibleLoops = filteredLoops.length > 0;
  const selectedDepartmentLabel = department === "all"
    ? "All departments"
    : departments.find((item) => item.key === department)?.label ?? titleCase(department);

  return (
    <>
      <PageHeader
        title="Loops"
        description="Specific loop definitions and execution configuration, without the company graph in the way."
        action={<Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/loops/new">New loop</Link>}
      />

      <DepartmentFilterBar activeDepartment={department} departments={departments} />

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        <aside className="rounded-lg border border-line bg-paper p-3">
          <div className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">
            Loop list
          </div>
          {hasVisibleLoops ? (
            <LoopList loops={filteredLoops} selectedLoopId={selectedLoop.id} />
          ) : (
            <EmptyLoopList departmentLabel={selectedDepartmentLabel} department={department} />
          )}
        </aside>
        {hasVisibleLoops ? (
          <>
            <LoopDetail workspace={{ ...workspace, loop: selectedLoop }} />
            <LoopContractSummary loop={selectedLoop} workspace={{ ...workspace, loop: selectedLoop }} />
          </>
        ) : (
          <EmptyDepartmentDetail department={department} departmentLabel={selectedDepartmentLabel} />
        )}
      </div>
    </>
  );
}

function EmptyLoopList({ department, departmentLabel }: { department: string; departmentLabel: string }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-white px-3 py-5 text-sm">
      <div className="font-semibold text-ink">No loops yet</div>
      <p className="mt-2 leading-6 text-ink/60">
        {departmentLabel} is ready as a department, but it does not have a loop definition yet.
      </p>
      <Link
        className="mt-4 inline-flex rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white"
        href={newLoopHref(department)}
      >
        Create first loop
      </Link>
    </div>
  );
}

function EmptyDepartmentDetail({ department, departmentLabel }: { department: string; departmentLabel: string }) {
  return (
    <section className="rounded-lg border border-line bg-white p-8 xl:col-span-2">
      <div className="max-w-2xl">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">
          Department setup
        </div>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink">{departmentLabel}</h2>
        <p className="mt-4 text-base leading-7 text-ink/65">
          Add the first workflow loop for this department to make it part of the operating brain.
          Once a loop exists, it will appear in the list, the Brain graph, and management rollups.
        </p>
        <Link
          className="mt-6 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
          href={newLoopHref(department)}
        >
          Create loop for {departmentLabel}
        </Link>
      </div>
    </section>
  );
}

function buildDepartmentOptions(workspace: WorkspaceData): DepartmentFilterOption[] {
  const byKey = new Map<string, DepartmentFilterOption>();
  for (const department of getDepartmentTemplates()) {
    byKey.set(department.key, { key: department.key, label: department.name });
  }
  for (const loop of workspace.loops) {
    if (!byKey.has(loop.department)) {
      byKey.set(loop.department, { key: loop.department, label: titleCase(loop.department) });
    }
  }
  return Array.from(byKey.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function newLoopHref(department: string) {
  if (department === "all") return "/loops/new";
  const catalogDepartment = getDepartmentTemplates().some((template) => template.key === department)
    ? department
    : "custom";
  return `/loops/new?department=${encodeURIComponent(catalogDepartment)}`;
}
