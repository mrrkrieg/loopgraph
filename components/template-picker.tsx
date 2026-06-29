"use client";

import { useMemo, useState } from "react";

type TemplateOption = {
  id: string;
  name: string;
  department: string;
  description: string;
  runtimeLevel: "runnable" | "spec_stub" | "catalog";
  primaryMetric?: string;
  dataSources: string[];
  owners: string[];
};

export function TemplatePicker({
  templates,
  defaultDepartment,
  defaultTemplateId
}: {
  templates: TemplateOption[];
  defaultDepartment: string;
  defaultTemplateId: string;
}) {
  const departments = useMemo(() => Array.from(new Set(templates.map((t) => t.department))), [templates]);
  const [department, setDepartment] = useState(defaultDepartment);
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId);
  const visibleTemplates = templates.filter((template) => template.department === department);

  return (
    <>
      <label className="block text-sm font-medium">
        Department
        <select
          name="department"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          value={department}
          onChange={(event) => {
            const nextDepartment = event.target.value;
            setDepartment(nextDepartment);
            const first = templates.find((template) => template.department === nextDepartment);
            if (first) setSelectedTemplateId(first.id);
          }}
        >
          {departments.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Loop template</legend>
        <div className="mt-2 grid max-h-[460px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
          {visibleTemplates.map((template) => {
            const selected = selectedTemplateId === template.id;
            return (
              <label
                className={`block cursor-pointer rounded-md border p-3 transition ${
                  selected ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"
                }`}
                key={template.id}
              >
                <input
                  checked={selected}
                  className="sr-only"
                  name="template_id"
                  onChange={() => setSelectedTemplateId(template.id)}
                  type="radio"
                  value={template.id}
                />
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-5">{template.name}</span>
                    <span className={`mt-1 line-clamp-3 block text-xs leading-5 ${selected ? "text-white/75" : "text-ink/60"}`}>
                      {template.description}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                    selected ? "border-white/35 text-white" : "border-line text-ink/60"
                  }`}>
                    {runtimeLabel(template.runtimeLevel)}
                  </span>
                </span>
                <span className={`mt-3 grid gap-1 text-[11px] ${selected ? "text-white/70" : "text-ink/55"}`}>
                  <span>Metric: {template.primaryMetric ?? "Quality-adjusted output"}</span>
                  <span>Data: {template.dataSources.slice(0, 3).join(", ")}</span>
                  <span>Owner: {template.owners[0] ?? "Loop owner"}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

function runtimeLabel(runtimeLevel: TemplateOption["runtimeLevel"]) {
  if (runtimeLevel === "runnable") return "Runnable";
  if (runtimeLevel === "spec_stub") return "Spec stub";
  return "Catalog";
}
