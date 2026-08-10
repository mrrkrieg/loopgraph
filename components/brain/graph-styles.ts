import type { BrainEdgeType, BrainNodeStatus, BrainNodeType } from "./graph-types";

export const departmentColors: Record<string, string> = {
  marketing: "#f97316",
  sales: "#2563eb",
  product: "#7c3aed",
  engineering: "#111827",
  customer_success: "#0f766e",
  operations_finance: "#047857",
  hr: "#be185d",
  legal_security: "#991b1b",
  management: "#111111",
  custom: "#6b7280"
};

export const nodeTypeStyles: Record<BrainNodeType, { color: string; stroke: string; radius: number }> = {
  company_brain: { color: "#111111", stroke: "#111111", radius: 54 },
  management_loop: { color: "#242321", stroke: "#111111", radius: 46 },
  department_loop: { color: "#f6f5f2", stroke: "#6f6a61", radius: 36 },
  workflow_loop: { color: "#ffffff", stroke: "#0f766e", radius: 28 },
  data: { color: "#eff6ff", stroke: "#2563eb", radius: 18 },
  metric: { color: "#ecfdf5", stroke: "#16a34a", radius: 18 },
  review: { color: "#fff7ed", stroke: "#f97316", radius: 18 },
  improvement: { color: "#f5f3ff", stroke: "#7c3aed", radius: 18 },
  trace: { color: "#f8fafc", stroke: "#64748b", radius: 16 }
};

export const statusStroke: Partial<Record<BrainNodeStatus, string>> = {
  active: "#111111",
  blocked: "#dc2626",
  draft: "#9ca3af",
  needs_attention: "#f97316",
  ready: undefined
};

export const edgeTypeStyles: Record<BrainEdgeType, { color: string; width: number; opacity: number; dashed?: boolean }> = {
  brain_routes_to: { color: "#111111", width: 2.4, opacity: 0.8 },
  management_calls_department: { color: "#37322d", width: 2, opacity: 0.64 },
  department_contains_loop: { color: "#57534e", width: 1.65, opacity: 0.52 },
  loop_observes_data: { color: "#2563eb", width: 1.25, opacity: 0.36 },
  loop_updates_metric: { color: "#16a34a", width: 1.25, opacity: 0.42 },
  loop_supports_loop: { color: "#0f766e", width: 1.4, opacity: 0.52, dashed: true },
  loop_returns_evidence: { color: "#7c3aed", width: 1.25, opacity: 0.42, dashed: true },
  loop_requires_review: { color: "#f97316", width: 1.35, opacity: 0.48, dashed: true },
  loop_learns_from_trace: { color: "#7c3aed", width: 1.2, opacity: 0.36, dashed: true }
};

export function nodeColorForDepartment(department?: string) {
  return department ? departmentColors[department] ?? departmentColors.custom : departmentColors.custom;
}
