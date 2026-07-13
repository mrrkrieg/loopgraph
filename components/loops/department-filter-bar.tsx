"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type DepartmentFilterOption = {
  key: string;
  label: string;
};

const customDepartmentStorageKey = "loopgraph.customDepartments";

export function DepartmentFilterBar({
  activeDepartment,
  departments
}: {
  activeDepartment: string;
  departments: DepartmentFilterOption[];
}) {
  const [customDepartments, setCustomDepartments] = useState<DepartmentFilterOption[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(customDepartmentStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setCustomDepartments(parsed.filter(isDepartmentOption));
      }
    } catch {
      setCustomDepartments([]);
    }
  }, []);

  const allDepartments = useMemo(() => {
    const byKey = new Map<string, DepartmentFilterOption>();
    for (const department of departments) byKey.set(department.key, department);
    for (const department of customDepartments) byKey.set(department.key, department);
    if (activeDepartment !== "all" && !byKey.has(activeDepartment)) {
      byKey.set(activeDepartment, { key: activeDepartment, label: labelFromKey(activeDepartment) });
    }
    return Array.from(byKey.values());
  }, [activeDepartment, customDepartments, departments]);

  function persistCustomDepartments(nextDepartments: DepartmentFilterOption[]) {
    setCustomDepartments(nextDepartments);
    window.localStorage.setItem(customDepartmentStorageKey, JSON.stringify(nextDepartments));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = name.trim();
    if (!label) {
      setError("Name the department first.");
      return;
    }
    const key = slugify(label);
    if (!key) {
      setError("Use at least one letter or number.");
      return;
    }

    const existing = allDepartments.find((department) => department.key === key);
    if (!existing) {
      persistCustomDepartments([...customDepartments, { key, label }].sort((left, right) => left.label.localeCompare(right.label)));
    }

    setName("");
    setError("");
    setIsAdding(false);
    window.location.href = `/loops?department=${encodeURIComponent(key)}`;
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3 text-sm">
      <FilterLink active={activeDepartment === "all"} href="/loops" label="All departments" />
      {allDepartments.map((item) => (
        <FilterLink
          active={activeDepartment === item.key}
          href={`/loops?department=${encodeURIComponent(item.key)}`}
          key={item.key}
          label={item.label}
        />
      ))}
      {isAdding ? (
        <form className="flex min-w-[260px] flex-wrap items-center gap-2" onSubmit={handleSubmit}>
          <input
            autoFocus
            className="h-9 min-w-40 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-ink"
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            placeholder="Department name"
            value={name}
          />
          <button className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white" type="submit">
            Add
          </button>
          <button
            className="h-9 rounded-md border border-line px-3 text-sm font-semibold text-ink/60 hover:border-ink hover:text-ink"
            onClick={() => {
              setIsAdding(false);
              setName("");
              setError("");
            }}
            type="button"
          >
            Cancel
          </button>
          {error ? <span className="basis-full text-xs font-medium text-red-600">{error}</span> : null}
        </form>
      ) : (
        <button
          className="rounded-md border border-dashed border-line bg-white px-3 py-1.5 font-semibold text-ink/60 hover:border-ink hover:text-ink"
          onClick={() => setIsAdding(true)}
          type="button"
        >
          Add department
        </button>
      )}
    </div>
  );
}

function FilterLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`rounded-md border px-3 py-1.5 font-semibold ${
        active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink/60 hover:border-ink hover:text-ink"
      }`}
      href={href}
    >
      {label}
    </Link>
  );
}

function isDepartmentOption(value: unknown): value is DepartmentFilterOption {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.key === "string" && typeof candidate.label === "string";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function labelFromKey(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
