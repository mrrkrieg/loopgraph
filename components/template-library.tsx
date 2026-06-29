"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DepartmentTemplate, LoopTemplate } from "@/lib/loop-engineering-builder/types";

type RuntimeFilter = "all" | LoopTemplate["runtimeLevel"];

export function TemplateLibrary({ departments }: { departments: DepartmentTemplate[] }) {
  const templates = useMemo(
    () => departments.flatMap((department) => department.commonLoops.map((template) => ({ ...template, departmentName: department.name }))),
    [departments]
  );
  const [department, setDepartment] = useState("all");
  const [runtime, setRuntime] = useState<RuntimeFilter>("all");
  const [query, setQuery] = useState("");
  const filteredTemplates = templates.filter((template) => {
    const matchesDepartment = department === "all" || template.department === department;
    const matchesRuntime = runtime === "all" || template.runtimeLevel === runtime;
    const searchable = `${template.name} ${template.description} ${template.primaryMetric ?? ""} ${template.requiredDataSources?.join(" ") ?? ""}`.toLowerCase();
    return matchesDepartment && matchesRuntime && searchable.includes(query.toLowerCase());
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(filteredTemplates[0]?.id ?? templates[0]?.id);
  const selectedTemplate =
    filteredTemplates.find((template) => template.id === selectedTemplateId) ??
    filteredTemplates[0] ??
    templates[0];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <div className="grid gap-3 rounded-md border border-line bg-white p-3 md:grid-cols-[1fr_180px_180px]">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Search
            <input
              className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search loops, sources, metrics"
              value={query}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Department
            <select
              className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink"
              onChange={(event) => setDepartment(event.target.value)}
              value={department}
            >
              <option value="all">All departments</option>
              {departments.map((item) => (
                <option key={item.key} value={item.key}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
            Maturity
            <select
              className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink"
              onChange={(event) => setRuntime(event.target.value as RuntimeFilter)}
              value={runtime}
            >
              <option value="all">All levels</option>
              <option value="runnable">Runnable</option>
              <option value="spec_stub">Spec stub</option>
              <option value="catalog">Catalog</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {filteredTemplates.map((template) => {
            const selected = selectedTemplate?.id === template.id;
            return (
              <button
                className={`rounded-md border p-4 text-left transition ${
                  selected ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"
                }`}
                key={template.id}
                onClick={() => setSelectedTemplateId(template.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-60">{template.departmentName}</div>
                    <div className="mt-1 font-semibold">{template.name}</div>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    selected ? "border-white/30" : "border-line text-ink/60"
                  }`}>
                    {runtimeLabel(template.runtimeLevel)}
                  </span>
                </div>
                <p className={`mt-2 line-clamp-3 text-sm leading-6 ${selected ? "text-white/75" : "text-ink/60"}`}>
                  {template.description}
                </p>
                <div className={`mt-3 text-xs ${selected ? "text-white/70" : "text-ink/50"}`}>
                  {template.primaryMetric ?? template.defaultMetrics?.[0] ?? "Quality-adjusted output"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="rounded-md border border-line bg-white p-4 xl:sticky xl:top-5 xl:self-start">
        {selectedTemplate ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Template detail</div>
            <h2 className="mt-2 text-xl font-semibold">{selectedTemplate.name}</h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">{selectedTemplate.description}</p>
            <div className="mt-4 grid gap-2 text-sm">
              <Detail label="Maturity" value={runtimeLabel(selectedTemplate.runtimeLevel)} />
              <Detail label="Department" value={selectedTemplate.departmentName} />
              <Detail label="Metric" value={selectedTemplate.primaryMetric ?? selectedTemplate.defaultMetrics?.[0] ?? "Quality-adjusted output"} />
              <Detail label="Owners" value={(selectedTemplate.defaultOwners ?? ["Loop owner"]).slice(0, 2).join(", ")} />
              <Detail label="Data" value={(selectedTemplate.requiredDataSources ?? []).slice(0, 4).join(", ") || "Template defaults"} />
            </div>
            <div className="mt-4 grid gap-2">
              <Link
                className="rounded-md bg-ink px-3 py-2 text-center text-sm font-semibold text-white"
                href={`/loops/new?template=${encodeURIComponent(selectedTemplate.id)}`}
              >
                Create LoopSpec
              </Link>
              <Link
                className="rounded-md border border-line px-3 py-2 text-center text-sm font-semibold hover:border-ink"
                href={`/topology?department=${selectedTemplate.department}`}
              >
                View in topology
              </Link>
            </div>
          </>
        ) : (
          <div className="text-sm text-ink/60">No templates match the current filters.</div>
        )}
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-3 py-2">
      <div className="text-xs text-ink/50">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function runtimeLabel(runtimeLevel: LoopTemplate["runtimeLevel"]) {
  if (runtimeLevel === "runnable") return "Runnable";
  if (runtimeLevel === "spec_stub") return "Spec stub";
  return "Catalog";
}
