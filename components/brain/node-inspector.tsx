"use client";

import React from "react";
import Link from "next/link";
import type { BrainGraphEdge, BrainGraphNode } from "./graph-types";

export function NodeInspector({
  node,
  edges,
  onOpenLocal
}: {
  node?: BrainGraphNode;
  edges: BrainGraphEdge[];
  onOpenLocal: (nodeId: string) => void;
}) {
  if (!node) {
    return (
      <aside className="h-full border-l border-line bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Inspector</div>
        <h2 className="mt-2 text-xl font-semibold">Select a node</h2>
        <p className="mt-2 text-sm leading-6 text-ink/60">
          Click a circle to inspect its purpose, owner, health, and next operating action.
        </p>
      </aside>
    );
  }

  const managedCount = numberValue(node.metadata?.managedCount);
  const owner = stringValue(node.metadata?.owner) || stringArrayValue(node.metadata?.owners);
  const trigger = stringValue(node.metadata?.trigger);
  const dataSources = stringList(node.metadata?.dataSources);
  const metrics = stringList(node.metadata?.metrics);
  const routine = stringList(node.metadata?.routine);
  const verification = stringList(node.metadata?.verification);

  return (
    <aside className="h-full overflow-auto border-l border-line bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/40">Inspector</div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold leading-tight">{node.label}</h2>
          <p className="mt-1 text-sm text-ink/55">{readableType(node.type)}</p>
        </div>
        <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink/70">
          {node.status.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/68">
        {summaryForNode(node)}
      </p>

      <div className="mt-5 grid gap-3">
        <InspectorFact label="Health" value={node.health ? `${node.health}%` : "Unscored"} />
        <InspectorFact label="Owner" value={owner || "Company management"} />
        <InspectorFact label="Managed loops" value={managedCount ? String(managedCount) : relationshipCount(node.id, edges)} />
        <InspectorFact label="Open reviews" value={String(node.openReviews ?? reviewCount(node.id, edges))} />
        <InspectorFact label="Missing data" value={String(node.missingData ?? dataSources.missing)} />
        <InspectorFact label="Primary metric" value={metrics.values[0] ?? "Undefined"} />
        <InspectorFact label="Last run" value={stringValue(node.metadata?.lastRunAt) ?? "Not recorded"} />
        <InspectorFact label="Next action" value={nextActionForNode(node)} />
      </div>

      {node.type === "workflow_loop" ? (
        <div className="mt-5 space-y-4 rounded-md border border-line bg-paper p-4">
          <CompactList title="Trigger" items={trigger ? [trigger] : []} empty="Manual or event trigger not configured" />
          <CompactList title="Data" items={dataSources.values.slice(0, 4)} empty="No data source listed" />
          <CompactList title="Routine" items={routine.values.slice(0, 4)} empty="No routine steps listed" />
          <CompactList title="Verifier" items={verification.values.slice(0, 3)} empty="No verifier listed" />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {isLoopNode(node) ? (
          <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" onClick={() => onOpenLocal(node.id)} type="button">
            Open local graph
          </button>
        ) : null}
        {node.loopId && node.type === "workflow_loop" ? (
          <Link className="rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink" href={`/loops/${node.loopId}`}>
            View full spec
          </Link>
        ) : null}
      </div>
    </aside>
  );
}

function InspectorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/40">{label}</div>
      <div className="mt-1 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}

function CompactList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{title}</div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm leading-5 text-ink/70">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 text-sm text-ink/45">{empty}</div>
      )}
    </div>
  );
}

function summaryForNode(node: BrainGraphNode) {
  if (node.type === "company_brain") {
    return "Receives company events and routes work into the management loop.";
  }
  if (node.type === "management_loop") {
    return "Routes company events, department rollups, escalations, and unresolved dependencies.";
  }
  if (node.type === "department_loop") {
    return "Coordinates workflow loops for a department and rolls evidence back into management.";
  }
  if (node.type === "workflow_loop") {
    return node.purpose ?? node.subtitle ?? "Executes a recurring AI-human operating loop with evidence and review.";
  }
  return node.subtitle ?? "Supporting node for the selected loop.";
}

function nextActionForNode(node: BrainGraphNode) {
  if (node.status === "blocked") return "Resolve blocker";
  if (node.status === "needs_attention") return "Review evidence";
  if (node.type === "department_loop") return "Inspect managed workflows";
  if (node.type === "workflow_loop") return "Open loop detail";
  return "Monitor";
}

function readableType(type: BrainGraphNode["type"]) {
  return type.replace(/_/g, " ");
}

function isLoopNode(node: BrainGraphNode) {
  return ["management_loop", "department_loop", "workflow_loop"].includes(node.type);
}

function relationshipCount(nodeId: string, edges: BrainGraphEdge[]) {
  return String(edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length);
}

function reviewCount(nodeId: string, edges: BrainGraphEdge[]) {
  return edges.filter((edge) => (edge.source === nodeId || edge.target === nodeId) && edge.type === "loop_requires_review").length;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : undefined;
}

function stringList(value: unknown) {
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    values,
    missing: values.length === 0 ? 1 : 0
  };
}
