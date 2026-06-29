"use client";

import { useMemo } from "react";

type TemplateOption = { id: string; name: string; department: string };

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

  return (
    <>
      <label className="block text-sm font-medium">
        Department
        <select
          name="department"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2"
          defaultValue={defaultDepartment}
          onChange={(event) => {
            const department = event.target.value;
            const select = event.currentTarget.form?.querySelector<HTMLSelectElement>('select[name="template_id"]');
            if (!select) return;
            const first = templates.find((template) => template.department === department);
            if (first) select.value = first.id;
          }}
        >
          {departments.map((department) => (
            <option key={department} value={department}>{department}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Loop template
        <select name="template_id" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={defaultTemplateId}>
          {templates.map((template) => (
            <option key={template.id} value={template.id} data-department={template.department}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
