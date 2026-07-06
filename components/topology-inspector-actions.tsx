import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import type { LoopGraph, LoopGraphNode } from "@/lib/loop-engineering-builder/types";
import {
  getExampleSimulateCommand,
  runtimeForLoop,
  type TopologyRuntimeSummary
} from "@/lib/loopgraph-runtime/topology-runtime";

type InspectorActionsProps = {
  graph: LoopGraph;
  node?: LoopGraphNode;
  runtime: TopologyRuntimeSummary;
  loopsById: Record<string, { id: string; templateId: string; sourcePath?: string }>;
};

export function InspectorActions({ graph, node, runtime, loopsById }: InspectorActionsProps) {
  if (!node) {
    return null;
  }

  const loopId = node.metadata?.loopId as string | undefined;
  const loopRecord = loopId ? loopsById[loopId] : undefined;
  const { latestRun, openCases } = runtimeForLoop(loopId, runtime);

  return (
    <div className="mb-4 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Actions</div>
      <div className="flex flex-wrap gap-2">
        <InspectorActionLinks graph={graph} node={node} latestRun={latestRun} openCases={openCases} />
      </div>
      <RuntimeStatus latestRun={latestRun} openCases={openCases} />
      <CliHint loopRecord={loopRecord} latestRun={latestRun} />
    </div>
  );
}

function InspectorActionLinks({
  graph,
  node,
  latestRun,
  openCases
}: {
  graph: LoopGraph;
  node: LoopGraphNode;
  latestRun?: { id: string; status: string };
  openCases: Array<{ id: string; severity: string; status: string }>;
}) {
  const loopId = node.metadata?.loopId as string | undefined;
  const runId = (node.metadata?.runId as string | undefined) ?? latestRun?.id;
  const reviewLoopId = (node.metadata?.loopId as string | undefined) ?? loopId;
  const caseId = node.metadata?.caseId as string | undefined;
  const ownerLoopId = findOwnerLoopId(graph, node);

  if (node.kind === "loop" && loopId) {
    return (
      <>
        <ActionLink href={`/loops/${loopId}`}>Open loop</ActionLink>
        <ActionLink href={`/loops/${loopId}/runs`}>View runs</ActionLink>
        <ActionLink href={`/loops/${loopId}/spec`}>View spec</ActionLink>
        {(latestRun?.status === "WAITING_FOR_REVIEW" || Number(node.metadata?.openReviews ?? 0) > 0) && runId ? (
          <ActionLink href={`/loops/${loopId}/reviews?runId=${runId}`} variant="attention">
            Review pending
          </ActionLink>
        ) : null}
        {openCases[0] ? (
          <ActionLink href={`/cases/${openCases[0].id}`} variant="attention">
            Open case
          </ActionLink>
        ) : null}
      </>
    );
  }

  if (node.kind === "management_loop") {
    return (
      <>
        <ActionLink href="/management">Open management</ActionLink>
        <ActionLink href="/dashboard">Dashboard</ActionLink>
      </>
    );
  }

  if (node.kind === "department" && node.department) {
    return <ActionLink href={`/topology?department=${node.department}`}>Filter to department</ActionLink>;
  }

  if (node.kind === "review" && reviewLoopId && runId) {
    return <ActionLink href={`/loops/${reviewLoopId}/reviews?runId=${runId}`}>Go to review</ActionLink>;
  }

  if (node.kind === "improvement" && loopId) {
    return <ActionLink href={`/loops/${loopId}`}>Open loop</ActionLink>;
  }

  if (node.kind === "escalation_case" && caseId) {
    return (
      <>
        <ActionLink href={`/cases/${caseId}`}>Open case</ActionLink>
        {loopId ? <ActionLink href={`/loops/${loopId}/runs`}>Source loop runs</ActionLink> : null}
      </>
    );
  }

  if (node.kind === "trace" && loopId && runId) {
    return (
      <>
        <ActionLink href={`/loops/${loopId}/runs/${runId}`}>Open trace</ActionLink>
        {latestRun?.status === "WAITING_FOR_REVIEW" ? (
          <ActionLink href={`/loops/${loopId}/reviews?runId=${runId}`} variant="attention">
            Review run
          </ActionLink>
        ) : null}
      </>
    );
  }

  if (ownerLoopId) {
    return <ActionLink href={`/loops/${ownerLoopId}`}>Open related loop</ActionLink>;
  }

  return null;
}

function RuntimeStatus({
  latestRun,
  openCases
}: {
  latestRun?: { id: string; status: string };
  openCases: Array<{ id: string; severity: string; status: string }>;
}) {
  if (!latestRun && openCases.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {latestRun ? <StatusPill>Latest run: {latestRun.status}</StatusPill> : null}
      {openCases.map((caseItem) => (
        <StatusPill key={caseItem.id}>
          Case {caseItem.severity} · {caseItem.status}
        </StatusPill>
      ))}
    </div>
  );
}

function CliHint({
  loopRecord,
  latestRun
}: {
  loopRecord?: { id: string; templateId: string; sourcePath?: string };
  latestRun?: { id: string; status: string };
}) {
  if (latestRun) {
    return null;
  }

  const command = getExampleSimulateCommand(loopRecord);
  if (!command) {
    return (
      <p className="text-xs leading-5 text-ink/55">
        No persisted runs yet. Create or simulate a loop to populate traces on this map.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Populate traces</div>
      <code className="mt-2 block whitespace-pre-wrap break-all text-[11px] leading-5 text-ink/70">{command}</code>
    </div>
  );
}

function ActionLink({
  href,
  children,
  variant = "default"
}: {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "attention";
}) {
  return (
    <Link
      className={`rounded-md border px-3 py-2 text-sm font-semibold ${
        variant === "attention"
          ? "border-amber-300 bg-amber-50 text-ink hover:border-amber-400"
          : "border-line bg-white text-ink hover:border-ink"
      }`}
      href={href}
    >
      {children}
    </Link>
  );
}

function findOwnerLoopId(graph: LoopGraph, node: LoopGraphNode): string | undefined {
  const edge = graph.edges.find(
    (item) =>
      (item.source === node.id && item.target.startsWith("loop:")) ||
      (item.target === node.id && item.source.startsWith("loop:"))
  );
  const loopNodeId = edge?.source.startsWith("loop:") ? edge.source : edge?.target;
  return loopNodeId?.replace("loop:", "");
}
