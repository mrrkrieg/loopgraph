import React from "react";
import type { AppInstallPlan } from "loopgraph/core";
import type { AppInstallImpactView } from "@/lib/app-platform/install-wizard";

export function InstallImpactReview({
  appName,
  department,
  plan,
  impact
}: {
  appName: string;
  department: string;
  plan: AppInstallPlan;
  impact: AppInstallImpactView;
}) {
  const reuseCount = impact.reusedGraphNodes.length
    + impact.reusedCapabilities.length
    + impact.reusedDependencies.length
    + impact.reusedFieldMappingCount;

  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <ImpactCard title="What Loopgraph will add" value={impact.additions.length} tone="default">
          <p>Immutable App-owned assets staged in {plan.initialMode} mode.</p>
          <ImpactDetails label="Review exact assets">
            {impact.additions.map((asset) => (
              <ImpactRow key={asset.id} primary={asset.id} secondary={humanize(asset.kind)} />
            ))}
          </ImpactDetails>
        </ImpactCard>

        <ImpactCard title="What it will reuse" value={reuseCount} tone="default">
          <p>Existing company objects, connections, dependencies, and confirmed field mappings stay shared.</p>
          <ImpactDetails label="Review reused resources">
            {impact.reusedGraphNodes.map((node) => <ImpactRow key={`node:${node.id}`} primary={node.label} secondary={humanize(node.type)} />)}
            {impact.reusedCapabilities.map((item) => <ImpactRow key={`capability:${item.capability}`} primary={item.capability} secondary={item.connectionId ? `Connection ${item.connectionId}` : "Reusable connection"} />)}
            {impact.reusedDependencies.map((item) => <ImpactRow key={`dependency:${item.appId}`} primary={item.appId} secondary={`Installed App ${item.version}`} />)}
            {impact.reusedFieldMappingCount > 0 ? <ImpactRow primary={`${impact.reusedFieldMappingCount} confirmed field mapping${impact.reusedFieldMappingCount === 1 ? "" : "s"}`} secondary="Workspace mapping registry" /> : null}
            {reuseCount === 0 ? <EmptyImpact>Nothing will be reused by this plan.</EmptyImpact> : null}
          </ImpactDetails>
        </ImpactCard>

        <ImpactCard title="Conflicts" value={impact.conflicts.length} tone={impact.conflicts.some((conflict) => conflict.blocking) ? "danger" : "safe"}>
          <p>{impact.conflicts.length === 0 ? "No graph or shared-object contract conflicts were detected." : "Blocking conflicts must be resolved before installation."}</p>
          {impact.conflicts.length > 0 ? (
            <ImpactDetails label="Review conflicts" open>
              {impact.conflicts.map((conflict) => (
                <ImpactRow key={`${conflict.kind}:${conflict.resourceId}`} primary={conflict.resourceId} secondary={`${humanize(conflict.kind)} · ${conflict.reason}`} />
              ))}
            </ImpactDetails>
          ) : null}
        </ImpactCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ImpactSection count={impact.permissions.length} title="Provider authority" description="The App can receive only these declared capabilities. Installation never grants direct provider execution.">
          {impact.permissions.map((permission) => (
            <div className="rounded-md border border-line px-3 py-3" key={permission.capability}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{permission.capability}</span>
                <span className="rounded-full bg-paper px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em]">{permission.decision.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-ink/55">{humanize(permission.authority)} authority · {permission.reason}</p>
            </div>
          ))}
        </ImpactSection>

        <ImpactSection count={impact.metrics.length} title="Outcome metrics" description="These are the results the App promises to measure; they are not proof of value until observed evidence exists.">
          {impact.metrics.length > 0 ? impact.metrics.map((metric) => (
            <div className="rounded-md border border-line px-3 py-3" key={metric.id}>
              <div className="text-sm font-semibold">{metric.metric ?? metric.description ?? "Declared outcome"}</div>
              <div className="mt-1 text-xs text-ink/50">{metric.loopName}{metric.direction ? ` · ${humanize(metric.direction)}` : ""}</div>
              {metric.description && metric.description !== metric.metric ? <p className="mt-2 text-xs leading-5 text-ink/55">{metric.description}</p> : null}
            </div>
          )) : <EmptyImpact>No outcome metrics are declared. This must be resolved before the App can prove value.</EmptyImpact>}
        </ImpactSection>
      </div>

      <ImpactSection count={impact.evidenceEdges.length} title="Evidence and learning topology" description="These signed edges define what evidence a loop may consume, produce, return to Hermes, or use for explicit supporting-loop fan-out.">
        {impact.evidenceEdges.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {impact.evidenceEdges.map((edge) => (
              <div className="rounded-md border border-line px-3 py-3" key={edge.id}>
                <div className="text-sm font-semibold">{edge.source} <span aria-hidden="true" className="text-ink/35">→</span> {edge.target}</div>
                <div className="mt-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-signal">{humanize(edge.type)}</div>
                {edge.reason ? <p className="mt-2 text-xs leading-5 text-ink/55">{edge.reason}</p> : null}
                {edge.condition ? <p className="mt-2 rounded-md bg-orange-50 px-2.5 py-2 text-xs leading-5 text-orange-900"><strong>Condition:</strong> {edge.condition}</p> : null}
              </div>
            ))}
          </div>
        ) : <EmptyImpact>No evidence topology is declared. Hermes cannot infer cross-loop fan-out.</EmptyImpact>}
      </ImpactSection>

      <div className="grid gap-4 lg:grid-cols-3">
        <ImpactSummary label="Graph changes" value={`${plan.graphDiff.nodesAdded.length} nodes · ${plan.graphDiff.edgesAdded.length} edges`} />
        <ImpactSummary label="Required conformance" value={`${plan.requiredTests.length} tests`} detail={plan.requiredTests.map(humanize).join(", ")} />
        <ImpactSummary label="Rollback contract" value={plan.rollback.preserveSharedAssets ? "Preserve shared assets" : "Remove all assets"} detail={plan.rollback.removeStagedAssets ? "Staged App assets are removed on rollback." : "Staged App assets remain."} />
      </div>

      <div className="rounded-md bg-paper p-3 font-mono text-xs leading-5 text-ink/60">Hermes Brain → {humanize(department)} → {appName} → {plan.assets.filter((asset) => asset.kind === "loop_spec").length} loops</div>
    </div>
  );
}

function ImpactCard({ children, title, value, tone }: { children: React.ReactNode; title: string; value: number; tone: "default" | "safe" | "danger" }) {
  const toneClass = tone === "danger" ? "border-red-300 bg-red-50" : tone === "safe" ? "border-emerald-300 bg-emerald-50" : "border-line bg-white";
  return <div className={`rounded-lg border p-4 ${toneClass}`}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{title}</h3><strong className="text-xl">{value}</strong></div><div className="mt-2 text-xs leading-5 text-ink/55">{children}</div></div>;
}

function ImpactDetails({ children, label, open = false }: { children: React.ReactNode; label: string; open?: boolean }) {
  return <details className="mt-3 border-t border-black/10 pt-3" open={open}><summary className="cursor-pointer text-xs font-semibold text-ink/70">{label}</summary><div className="mt-2 space-y-2">{children}</div></details>;
}

function ImpactRow({ primary, secondary }: { primary: string; secondary: string }) {
  return <div className="rounded-md bg-white/75 px-2.5 py-2"><div className="break-all font-mono text-[0.68rem] font-semibold text-ink/75">{primary}</div><div className="mt-1 text-[0.68rem] leading-4 text-ink/45">{secondary}</div></div>;
}

function ImpactSection({ children, title, description, count }: { children: React.ReactNode; title: string; description: string; count: number }) {
  return (
    <details className="rounded-lg border border-line bg-white p-4">
      <summary className="cursor-pointer list-none">
        <span className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{title}</span><strong className="text-sm">{count}</strong></span>
        <span className="mt-1 block text-xs leading-5 text-ink/50">{description}</span>
        <span className="mt-2 block text-xs font-semibold text-ink/65">Review exact details</span>
      </summary>
      <div className="mt-4 space-y-3 border-t border-line pt-4">{children}</div>
    </details>
  );
}

function ImpactSummary({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-lg border border-line bg-paper p-4"><div className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink/40">{label}</div><div className="mt-2 text-sm font-semibold">{value}</div>{detail ? <p className="mt-2 text-xs leading-5 text-ink/50">{detail}</p> : null}</div>;
}

function EmptyImpact({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-line px-3 py-3 text-xs leading-5 text-ink/50">{children}</div>;
}

function humanize(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
