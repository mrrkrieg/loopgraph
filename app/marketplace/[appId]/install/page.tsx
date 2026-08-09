import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getAppInstallPlanViewData } from "@/lib/app-platform/read-model";

export const dynamic = "force-dynamic";

export default async function AppInstallPlanPage({
  params,
  searchParams
}: {
  params: Promise<{ appId: string }>;
  searchParams?: Promise<{ preset?: string }>;
}) {
  const [{ appId }, query] = await Promise.all([params, searchParams]);
  const decodedAppId = decodeURIComponent(appId);
  let data;
  try {
    const presetId = query?.preset ?? "";
    if (!presetId) notFound();
    data = await getAppInstallPlanViewData(decodedAppId, presetId);
  } catch (error) {
    if (error instanceof Error && /not found|unknown preset/i.test(error.message)) notFound();
    throw error;
  }
  const missingCapabilities = data.plan.capabilityResolutions.filter((resolution) => resolution.required && !["connected", "reusable"].includes(resolution.status));
  const connectedCapabilities = data.plan.capabilityResolutions.filter((resolution) => ["connected", "reusable"].includes(resolution.status));
  const ready = missingCapabilities.length === 0 && data.plan.missingConfigurationKeys.length === 0 && !data.plan.permissions.some((permission) => permission.decision === "unresolved");

  return (
    <>
      <div className="mb-4 text-sm text-ink/50"><Link href={`/marketplace/${encodeURIComponent(data.detail.app.id)}`} className="hover:text-ink">{data.detail.app.name}</Link> / install plan</div>
      <PageHeader
        eyebrow="Read-only installation plan"
        title={`Connect and configure ${data.detail.app.name}`}
        description="This exact, content-bound plan shows what Loopgraph would add, reuse, request, and test. Reviewing it does not install the app or enable provider writes."
      />

      <div className={`mb-6 rounded-xl border p-5 ${ready ? "border-emerald-300 bg-emerald-50" : "border-orange-300 bg-orange-50"}`}>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Recommended next action</div>
        <h2 className="mt-2 text-xl font-semibold">{ready ? "Plan is ready for governed installation" : "Complete the missing connections and company context"}</h2>
        <p className="mt-2 text-sm leading-6 text-ink/65">
          {ready
            ? "Hermes can apply this exact plan atomically, run the conformance suite, and keep the app in simulation or shadow mode."
            : "Hermes can guide these steps conversationally and then generate a fresh plan. Nothing is partially installed while blockers remain."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {!ready ? <Link className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/settings/integrations">Connect required systems</Link> : null}
          <Link className="rounded-md border border-ink/20 bg-white px-4 py-2 text-sm font-semibold" href="/discovery">Continue with Hermes</Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Stack resolution" description="Apps ask for logical business capabilities. Connector recipes bind them to the provider stack you selected.">
          <div className="space-y-3">
            {data.plan.capabilityResolutions.map((resolution) => (
              <div className="flex items-start justify-between gap-4 rounded-md border border-line p-3" key={resolution.capability}>
                <div><div className="font-mono text-xs font-semibold">{resolution.capability}</div><div className="mt-1 text-xs text-ink/45">{resolution.required ? "Required" : "Optional"}{resolution.recipeId ? ` · ${resolution.recipeId}` : ""}</div></div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${["connected", "reusable"].includes(resolution.status) ? "bg-emerald-100 text-emerald-800" : resolution.required ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-600"}`}>{resolution.status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
          {connectedCapabilities.length === 0 ? <p className="mt-4 text-sm leading-6 text-ink/55">No compatible provider connection is registered yet. Provider credentials stay in the Connector Broker or enterprise vault; Loopgraph stores only non-secret bindings.</p> : null}
        </SectionCard>

        <SectionCard title="Company-specific configuration" description="Pack defaults are overridden by presets, approved company context, confirmed install answers, and typed overlays—in that order.">
          {data.plan.missingConfigurationKeys.length > 0 ? (
            <ul className="space-y-2">
              {data.plan.missingConfigurationKeys.map((key) => <li className="rounded-md border border-line bg-paper/40 px-3 py-2 font-mono text-xs" key={key}>{key}</li>)}
            </ul>
          ) : <p className="text-sm text-emerald-700">All required values are resolved and confirmed.</p>}
        </SectionCard>

        <SectionCard title="Graph transaction" description="The app boundary keeps its loops operable as one product while preserving the underlying governed LoopSpecs.">
          <MetricGrid items={[
            ["Nodes added", data.plan.graphDiff.nodesAdded.length],
            ["Nodes reused", data.plan.graphDiff.nodesReused.length],
            ["Edges added", data.plan.graphDiff.edgesAdded.length],
            ["Conflicts", data.plan.graphDiff.edgesRemoved.length]
          ]} />
          <div className="mt-4 rounded-md bg-paper p-3 font-mono text-xs leading-5 text-ink/60">Hermes Brain → Sales → {data.detail.app.name} → {data.detail.loops.length} loops</div>
        </SectionCard>

        <SectionCard title="Permission review" description="Install records requested authority but cannot grant live execution.">
          <div className="space-y-2">
            {data.plan.permissions.map((permission) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line py-2 last:border-0" key={permission.capability}>
                <div><div className="font-mono text-xs font-semibold">{permission.capability}</div><div className="mt-1 text-xs leading-5 text-ink/50">{permission.reason}</div></div>
                <div className="text-right text-xs"><div className="font-semibold capitalize">{permission.authority}</div><div className="mt-1 capitalize text-ink/45">{permission.decision.replace(/_/g, " ")}</div></div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard className="mt-5" title="Tests required before activation" description="Conformance runs with provider writes blocked. Historical replay and production promotion remain separate evidence gates.">
        <div className="flex flex-wrap gap-2">{data.plan.requiredTests.map((test) => <span className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-semibold" key={test}>{test.replace(/_/g, " ")}</span>)}</div>
        <div className="mt-5 border-t border-line pt-4 text-xs text-ink/45">Plan digest <span className="font-mono">{data.plan.planDigest}</span> · expires {new Date(data.plan.expiresAt).toLocaleString()}</div>
      </SectionCard>
    </>
  );
}

function MetricGrid({ items }: { items: Array<[string, number]> }) {
  return <div className="grid grid-cols-2 gap-3">{items.map(([label, value]) => <div className="rounded-md border border-line p-3" key={label}><div className="text-xl font-semibold">{value}</div><div className="mt-1 text-xs uppercase tracking-[0.1em] text-ink/45">{label}</div></div>)}</div>;
}
