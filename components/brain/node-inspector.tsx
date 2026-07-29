"use client";

import React from "react";
import Link from "next/link";
import type { BrainGraphEdge, BrainGraphNode } from "./graph-types";

export type BrainGraphActions = {
  validateLoop?: (formData: FormData) => void | Promise<void>;
  simulateFixture?: (formData: FormData) => void | Promise<void>;
  simulateManualEvent?: (formData: FormData) => void | Promise<void>;
};

export function NodeInspector({
  actions,
  node,
  edges,
  onOpenLocal
}: {
  actions?: BrainGraphActions;
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

      <LoopRunControls actions={actions} node={node} />

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

function LoopRunControls({
  actions,
  node
}: {
  actions?: BrainGraphActions;
  node: BrainGraphNode;
}) {
  if (node.type !== "workflow_loop" || !node.loopId) {
    return null;
  }

  const runtime = runtimeMetadata(node);
  const problemTypes = stringList(runtime.routing?.problemTypes);
  const requiredConnections = stringList(runtime.routing?.requiredConnections);
  const activationMode = stringValue(runtime.routing?.activationMode) ?? "not set";
  const routingReady = Boolean(runtime.routing?.ready);
  const latestRun = latestRunMetadata(node);
  const dataSources = stringList(node.metadata?.dataSources);
  const owner = stringValue(node.metadata?.owner) || stringArrayValue(node.metadata?.owners) || "Department owner";
  const metrics = stringList(node.metadata?.metrics);

  return (
    <div className="mt-5 rounded-md border border-line bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Hermes local run controls</div>
      <p className="mt-2 text-sm leading-6 text-ink/60">
        Validate this registered loop, then run a generated synthetic Hermes event locally. Live provider webhooks should still terminate at Hermes first.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <StatusToken tone={routingReady ? "ready" : "blocked"}>
          {routingReady ? "Routing ready" : "Routing missing"}
        </StatusToken>
        <StatusToken>{activationMode.replace(/_/g, " ")}</StatusToken>
        {problemTypes.values.slice(0, 2).map((type) => <StatusToken key={type}>{type.replace(/_/g, " ")}</StatusToken>)}
      </div>
      {latestRun ? (
        <Link
          className="mt-3 block rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink/70 hover:border-ink hover:text-ink"
          href={`/loops/${node.loopId}/runs/${latestRun.id}`}
        >
          Latest run: <span className="font-semibold">{latestRun.status.replace(/_/g, " ")}</span>
          <span className="ml-2 font-mono text-xs text-ink/45">{latestRun.id}</span>
        </Link>
      ) : null}
      <ConnectionChecklist
        activationMode={activationMode}
        dataSources={dataSources.values}
        metrics={metrics.values}
        owner={owner}
        problemTypes={problemTypes.values}
        requiredConnections={requiredConnections.values}
      />
      <div className="mt-4 space-y-2">
        {actions?.validateLoop ? (
          <form action={actions.validateLoop}>
            <input name="loopId" type="hidden" value={node.loopId} />
            <button className="w-full rounded-md border border-ink px-3 py-2 text-sm font-semibold text-ink" type="submit">
              Validate loop
            </button>
          </form>
        ) : null}
        {runtime.inputFixtures.length > 0 && actions?.simulateFixture ? (
          <div className="grid gap-2">
            {runtime.inputFixtures.map((fixture) => (
              <form action={actions.simulateFixture} key={fixture.id}>
                <input name="loopId" type="hidden" value={node.loopId} />
                <input name="fixtureId" type="hidden" value={fixture.id} />
                <button className="w-full rounded-md bg-ink px-3 py-2 text-left text-sm font-semibold text-white" type="submit">
                  Simulate {fixture.label}
                </button>
              </form>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-line bg-paper px-3 py-2 text-sm text-ink/55">
            No generated synthetic fixtures are available for this loop yet.
          </div>
        )}
        {actions?.simulateManualEvent ? (
          <details className="rounded-md border border-line bg-paper p-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              Simulate custom event JSON
            </summary>
            <form action={actions.simulateManualEvent} className="mt-3 space-y-3">
              <input name="loopId" type="hidden" value={node.loopId} />
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Manual synthetic fixture</span>
                <textarea
                  className="mt-2 min-h-44 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink"
                  name="fixtureJson"
                  defaultValue={manualFixtureTemplate(node)}
                />
              </label>
              <p className="text-xs leading-5 text-ink/55">
                Use redacted synthetic data only. The JSON must include eventId and simulatedAt; no live provider write will run from this control.
              </p>
              <button className="w-full rounded-md border border-ink px-3 py-2 text-sm font-semibold text-ink" type="submit">
                Simulate custom event
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function ConnectionChecklist({
  activationMode,
  dataSources,
  metrics,
  owner,
  problemTypes,
  requiredConnections
}: {
  activationMode: string;
  dataSources: string[];
  metrics: string[];
  owner: string;
  problemTypes: string[];
  requiredConnections: string[];
}) {
  const primaryProblem = problemTypes[0]?.replace(/_/g, " ") ?? "the accepted business problem";
  const primaryMetric = metrics[0] ?? "a measurable outcome";
  const capabilityRows = requiredConnections.length > 0
    ? requiredConnections.slice(0, 5).map((connection) => ({
        title: connectionLabel(connection),
        detail: `Required capability: ${connection}`
      }))
    : dataSources.slice(0, 4).map((source) => ({
        title: source,
        detail: "Source of truth or evidence source inferred from the LoopSpec"
      }));

  return (
    <div className="mt-4 rounded-md border border-line bg-paper p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Connect next</div>
      <p className="mt-2 text-sm leading-6 text-ink/60">
        Keep this loop in <span className="font-medium text-ink">{activationMode.replace(/_/g, " ")}</span> until Hermes routes a redacted test event,
        Loopgraph validates the contract, and the human owner approves the rollout boundary.
      </p>
      <ol className="mt-3 space-y-2 text-sm">
        <ChecklistItem
          title="1. Event source → Hermes"
          detail={`Send normalized ${primaryProblem} events to Hermes Brain; do not point provider webhooks directly at this loop.`}
        />
        {capabilityRows.map((row, index) => (
          <ChecklistItem
            detail={row.detail}
            key={`${row.title}:${index}`}
            title={`${index + 2}. ${row.title}`}
          />
        ))}
        <ChecklistItem
          title={`${capabilityRows.length + 2}. Human owner / approval`}
          detail={`${owner} owns ambiguous routing, risky actions, and promotion beyond shadow mode.`}
        />
        <ChecklistItem
          title={`${capabilityRows.length + 3}. Outcome evidence`}
          detail={`Return ${primaryMetric} or review results to Loopgraph so future Hermes decisions improve.`}
        />
      </ol>
    </div>
  );
}

function ChecklistItem({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="rounded border border-line bg-white px-3 py-2">
      <div className="font-semibold text-ink">{title}</div>
      <div className="mt-1 text-xs leading-5 text-ink/55">{detail}</div>
    </li>
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

function StatusToken({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ready" | "blocked";
}) {
  const className = tone === "ready"
    ? "border-green-200 bg-green-50 text-green-800"
    : tone === "blocked"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-line bg-paper text-ink/65";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
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
    if (node.metadata?.hierarchyMode === "hermes_brain") {
      return "Receives business events and decides which department loop should handle the problem, abstaining when the evidence is ambiguous.";
    }
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

function connectionLabel(value: string) {
  const [system, capability] = value.split(".");
  if (!capability) {
    return value.replace(/_/g, " ");
  }
  return `${system.replace(/_/g, " ")} ${capability.replace(/_/g, " ")}`;
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

type InspectorRuntimeMetadata = {
  inputFixtures: Array<{
    id: string;
    label: string;
  }>;
  routing?: {
    ready?: boolean;
    problemTypes?: unknown;
    activationMode?: unknown;
    requiredConnections?: unknown;
  };
};

type InspectorLatestRunMetadata = {
  id: string;
  status: string;
};

function runtimeMetadata(node: BrainGraphNode): InspectorRuntimeMetadata {
  const value = node.metadata?.runtime;
  if (!isRecord(value)) {
    return { inputFixtures: [] };
  }
  return {
    inputFixtures: Array.isArray(value.inputFixtures)
      ? value.inputFixtures.flatMap((fixture) => {
          if (!isRecord(fixture) || typeof fixture.id !== "string") {
            return [];
          }
          return [{
            id: fixture.id,
            label: typeof fixture.label === "string" && fixture.label.trim()
              ? fixture.label
              : fixture.id.replace(/[-_]/g, " ")
          }];
        })
      : [],
    routing: isRecord(value.routing)
      ? {
          ready: typeof value.routing.ready === "boolean" ? value.routing.ready : undefined,
          problemTypes: value.routing.problemTypes,
          activationMode: value.routing.activationMode,
          requiredConnections: value.routing.requiredConnections
        }
      : undefined
  };
}

function latestRunMetadata(node: BrainGraphNode): InspectorLatestRunMetadata | undefined {
  const value = node.metadata?.latestRun;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") {
    return undefined;
  }
  return {
    id: value.id,
    status: value.status
  };
}

function manualFixtureTemplate(node: BrainGraphNode): string {
  const problemType = firstString(runtimeMetadata(node).routing?.problemTypes) ?? "custom_business_problem";
  return JSON.stringify({
    eventId: `manual_${safeId(node.loopId ?? node.id)}_001`,
    simulatedAt: "2026-07-21T12:00:00.000Z",
    synthetic: true,
    scenario: "manual-custom-event",
    trigger: {
      sourceRoute: "hermes.manual",
      eventType: `${problemType}.manual_test`,
      subject: {
        type: "work_item",
        id: "manual_test_1"
      }
    },
    expectedAssessment: {
      decisionSummary: `Manual synthetic event for ${node.label}. Replace this with redacted local evidence.`,
      assumptions: [{
        id: "assumption_manual_fixture",
        statement: "This is a synthetic local simulation fixture, not a live provider webhook.",
        confidence: 1
      }],
      proposedActions: [],
      evidence: [{
        id: "evidence_manual_fixture",
        sourceId: "manual.fixture",
        sourceType: "fixture",
        excerpt: "Synthetic redacted event payload.",
        trusted: false
      }],
      policyInputs: [{ key: "confidence", value: 0.75, source: "manual-fixture" }],
      verificationRequest: { required: false, checks: ["evidence"] },
      escalationRequest: { required: false }
    }
  }, null, 2);
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string" && item.length > 0) : undefined;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
