import React from "react";
import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { listDepartmentCatalog } from "loopgraph/core";
import { selectBrowserDiscoveryDepartmentsAction } from "../actions";
import {
  getDiscoverySessionForView,
  getDiscoverySessionIdFromSearchParams,
  type DiscoverySearchParams
} from "../view-data";

export default async function DepartmentDiscoveryPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const sessionId = await getDiscoverySessionIdFromSearchParams(searchParams);
  const session = await getDiscoverySessionForView(sessionId);
  const catalog = listDepartmentCatalog({ includeCustom: true });
  const selected = new Set(session.selectedDepartmentIds);
  const defaultActiveDepartment = session.activeDepartmentId ?? session.selectedDepartmentIds[0] ?? "product";
  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Departments"
        description={sessionId
          ? "Choose the departments this shared Hermes/browser discovery session should design loops for."
          : "Department profiles come from the demo company context and skill packs."}
      />
      <DiscoveryStepNav activeHref="/discovery/departments" sessionId={sessionId} />
      {sessionId ? (
        <SectionCard
          title="Choose departments for the shared session"
          description="These are the same canonical departments Hermes receives through MCP. Select one or more and choose the active department for the next five question bundles."
        >
          <form action={selectBrowserDiscoveryDepartmentsAction} className="space-y-5">
            <input type="hidden" name="sessionId" value={session.id} />
            <input type="hidden" name="expectedRevision" value={session.revision} />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {catalog.map((department) => {
                const isSelected = selected.has(department.id);
                const isActive = defaultActiveDepartment === department.id;
                return (
                  <div key={department.id} className="rounded-lg border border-line bg-white p-4">
                    <label className="flex items-start gap-3">
                      <input
                        className="mt-1"
                        type="checkbox"
                        name="departments"
                        value={department.id}
                        defaultChecked={isSelected || (!session.selectedDepartmentIds.length && department.id === "product")}
                      />
                      <div>
                        <div className="font-semibold text-ink">{department.label}</div>
                        <p className="mt-1 text-sm leading-6 text-ink/60">{department.description}</p>
                      </div>
                    </label>
                    <label className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                      <input
                        type="radio"
                        name="activeDepartment"
                        value={department.id}
                        defaultChecked={isActive}
                      />
                      Active first
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
                Save and answer questions
              </button>
              <Link className="text-sm font-medium text-ink/60 hover:text-ink" href={`/discovery?sessionId=${encodeURIComponent(session.id)}`}>
                Back to session
              </Link>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <div className="mt-5" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(session.departmentProfiles.length ? session.departmentProfiles : []).map((department) => (
          <SectionCard key={department.id} title={department.name} description={department.goal}>
            <div className="space-y-3 text-sm">
              <div><span className="font-medium">Owner:</span> {department.ownerRole}</div>
              <div className="flex flex-wrap gap-2">
                {department.tools.map((tool) => <StatusPill key={tool}>{tool}</StatusPill>)}
              </div>
              <div className="text-ink/60">{department.painPoints.length ? department.painPoints.join(", ") : "No department-specific pain captured yet."}</div>
            </div>
          </SectionCard>
        ))}
      </div>
      {sessionId && session.departmentProfiles.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-line bg-paper p-5 text-sm leading-6 text-ink/60">
          No departments saved yet. Pick Product, Marketing, Sales, or any department above to start the five-bundle discovery flow.
        </div>
      ) : null}
    </>
  );
}
