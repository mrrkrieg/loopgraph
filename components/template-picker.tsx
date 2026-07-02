"use client";

import { useMemo, useState } from "react";
import { LoopGraphView } from "@/components/loop-graph-view";
import { buildTemplateLoopGraph } from "@/lib/loop-engineering-builder/loop-graph-visualization";
import type { LoopTemplate } from "@/lib/loop-engineering-builder/types";

type TemplateOption = LoopTemplate & {
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
  const [department, setDepartment] = useState("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId);
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const visibleTemplates = department === "all"
    ? templates
    : templates.filter((template) => template.department === department);
  const groupedTemplates = departments
    .map((department) => ({
      department,
      templates: visibleTemplates.filter((template) => template.department === department)
    }))
    .filter((group) => group.templates.length > 0);

  return (
    <>
      <label className="block text-sm font-medium">
        Department
        <select
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          value={department}
          onChange={(event) => {
            const nextDepartment = event.target.value;
            setDepartment(nextDepartment);
            if (nextDepartment === "all") return;
            const selectedStillVisible = templates.some(
              (template) => template.id === selectedTemplateId && template.department === nextDepartment
            );
            const first = templates.find((template) => template.department === nextDepartment);
            if (!selectedStillVisible && first) setSelectedTemplateId(first.id);
          }}
        >
          <option value="all">All departments ({templates.length} templates)</option>
          {departments.map((department) => (
            <option key={department} value={department}>
              {departmentLabel(department)} ({templates.filter((template) => template.department === department).length})
            </option>
          ))}
        </select>
      </label>
      <input name="department" type="hidden" value={selectedTemplate?.department ?? defaultDepartment} />
      <fieldset>
        <legend className="flex w-full items-center justify-between gap-3 text-sm font-medium">
          <span>Loop template</span>
          <span className="text-xs font-normal text-ink/55">{visibleTemplates.length} available</span>
        </legend>
        <div className="mt-2 max-h-[560px] overflow-y-auto pr-1">
          <div className="grid gap-4">
            {groupedTemplates.map((group) => (
              <section className="grid gap-2" key={group.department}>
                {department === "all" ? (
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/95 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">
                    <span>{departmentLabel(group.department)}</span>
                    <span>{group.templates.length}</span>
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  {group.templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      selected={selectedTemplateId === template.id}
                      template={template}
                      onSelect={() => setSelectedTemplateId(template.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </fieldset>
    </>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect
}: {
  template: TemplateOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const previewGraph = useMemo(() => buildTemplateLoopGraph(template), [template]);

  return (
    <label
      className={`block cursor-pointer rounded-md border p-3 transition ${
        selected ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"
      }`}
    >
      <input
        checked={selected}
        className="sr-only"
        name="template_id"
        onChange={onSelect}
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
      <span className="mt-3 block h-24 overflow-hidden rounded-md">
        <LoopGraphView
          appearance={selected ? "onDark" : "light"}
          graph={previewGraph}
          interactive={false}
          variant="mini"
        />
      </span>
      <span className={`mt-3 grid gap-1 text-[11px] ${selected ? "text-white/70" : "text-ink/55"}`}>
        <span>Metric: {template.primaryMetric ?? "Quality-adjusted output"}</span>
        <span>Data: {template.dataSources.slice(0, 3).join(", ")}</span>
        <span>Owner: {template.owners[0] ?? "Loop owner"}</span>
      </span>
    </label>
  );
}

function departmentLabel(department: string) {
  const labels: Record<string, string> = {
    customer_success: "Customer Success",
    engineering: "Engineering",
    hr: "HR",
    legal_security: "Legal / Security",
    management: "Management",
    marketing: "Marketing",
    operations_finance: "Operations / Finance",
    product: "Product",
    sales: "Sales",
    custom: "Custom"
  };

  return labels[department] ?? department;
}

function runtimeLabel(runtimeLevel: TemplateOption["runtimeLevel"]) {
  if (runtimeLevel === "runnable") return "Runnable";
  if (runtimeLevel === "spec_stub") return "Spec stub";
  return "Catalog";
}
