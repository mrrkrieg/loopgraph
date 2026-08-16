import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStatusPill } from "@/components/apps/app-status-pill";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getMarketplaceAppDetailView } from "@/lib/app-platform/read-model";

export const dynamic = "force-dynamic";

export default async function MarketplaceAppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  let data;
  try {
    data = await getMarketplaceAppDetailView(decodeURIComponent(appId));
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) notFound();
    throw error;
  }
  const defaultPreset = data.manifest.presets[0];

  return (
    <>
      <div className="mb-4 text-sm text-ink/50">
        <Link className="hover:text-ink" href="/marketplace">Marketplace</Link> / {data.app.name}
      </div>
      <PageHeader
        eyebrow={`${data.app.department.replace(/_/g, " ")} · Loopgraph App`}
        title={data.app.name}
        description={data.app.description}
        action={<AppStatusPill state={data.installation?.state} readiness={data.readiness?.state} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          <section className="rounded-xl border border-ink bg-ink p-6 text-white">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">What Hermes will do</div>
            <p className="mt-3 max-w-3xl text-lg leading-8 text-white/85">{data.app.summary}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <HeroFact label="Loops" value={String(data.loops.length)} />
              <HeroFact label="Hermes skills" value={String(data.skills.length)} />
              <HeroFact label="Safety scenarios" value={String(data.evaluationSummary.scenarios)} />
            </div>
          </section>

          <SectionCard title="Included operating loops" description="Hermes routes one business problem into the clearest eligible loop, while related loops receive evidence only when the topology permits it.">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.loops.map((loop, index) => (
                <div className="rounded-lg border border-line bg-paper/40 p-4" key={loop.id}>
                  <div className="text-xs font-semibold text-signal">Loop {index + 1}</div>
                  <h3 className="mt-1 font-semibold">{loop.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/60">{loop.description}</p>
                  <div className="mt-3 text-xs text-ink/45">Owner · {loop.owner?.replace(/_/g, " ") ?? "Configured during install"}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Company graph preview" description="The signed pack defines the company objects, permitted supporting routes, and learning returns. Hermes remains the event router and may fan out only across declared supporting edges.">
            <GraphPreview edges={data.graphPreview.edges} nodes={data.graphPreview.nodes} />
          </SectionCard>

          <SectionCard title="Company information Hermes needs" description="Approved company context is reused. Hermes asks only for values that are missing, uncertain, or important enough to confirm.">
            <div className="divide-y divide-line">
              {data.setupQuestions.map((question) => (
                <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_10rem]" key={question.key}>
                  <div>
                    <div className="font-medium">{question.prompt}</div>
                    <p className="mt-1 text-sm leading-6 text-ink/55">{question.why}</p>
                  </div>
                  <div className="text-xs text-ink/45 sm:text-right">
                    <div className="font-semibold uppercase tracking-[0.12em]">{question.requirement}</div>
                    <div className="mt-1">{question.inferFromContext ? "Can reuse company context" : "Asked during setup"}</div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Permissions" description="Installation cannot enable provider writes. High-risk and customer-facing actions remain forbidden or approval-gated until separately promoted.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.12em] text-ink/45"><tr><th className="pb-3">Capability</th><th className="pb-3">Authority</th><th className="pb-3">Risk</th><th className="pb-3">Default</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.manifest.permissions.map((permission) => (
                    <tr key={permission.capability}><td className="py-3 font-medium">{permission.capability}</td><td className="py-3 capitalize">{permission.authority}</td><td className="py-3 capitalize">{permission.risk}</td><td className="py-3 capitalize">{permission.defaultPolicy.replace(/_/g, " ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Version</span><span className="font-mono text-xs">v{data.selectedVersion.version}</span></div>
            <div className="mt-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Publisher</span><span className="text-sm font-semibold">{data.app.publisher.name}{data.app.publisher.verified ? " ✓" : ""}</span></div>
            <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Source</span><span className="truncate font-mono text-xs">{data.provenance.sourceId}</span></div>
            {data.provenance.sourceRef ? <div className="mt-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Commit</span><span className="font-mono text-xs">{data.provenance.sourceRef.slice(0, 12)}</span></div> : null}
            <div className="mt-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Artifact</span><span className="font-mono text-xs">{data.provenance.verified ? "verified" : "unverified"}</span></div>
            {data.installation ? (
              <Link className="mt-5 flex w-full items-center justify-center rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white" href={`/apps/${encodeURIComponent(data.installation.id)}`}>Open installed app</Link>
            ) : defaultPreset ? (
              <Link className="mt-5 flex w-full items-center justify-center rounded-md bg-signal px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600" href={`/marketplace/${encodeURIComponent(data.app.id)}/install?preset=${encodeURIComponent(defaultPreset.id)}`}>Review install plan</Link>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-ink/45">Review is read-only. Nothing becomes active and no provider write is enabled.</p>
          </section>

          <SectionCard title="Compatible stacks">
            <div className="space-y-3">
              {data.manifest.presets.map((preset) => (
                <Link className="block rounded-md border border-line p-3 hover:border-ink" href={`/marketplace/${encodeURIComponent(data.app.id)}/install?preset=${encodeURIComponent(preset.id)}`} key={preset.id}>
                  <div className="text-sm font-semibold">{preset.name}</div>
                  <p className="mt-1 text-xs leading-5 text-ink/55">{preset.description}</p>
                </Link>
              ))}
            </div>
          </SectionCard>
        </aside>
      </div>
    </>
  );
}

function HeroFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/15 bg-white/5 p-4"><div className="text-2xl font-semibold">{value}</div><div className="mt-1 text-xs uppercase tracking-[0.12em] text-white/50">{label}</div></div>;
}

function GraphPreview({
  nodes,
  edges
}: {
  nodes: Array<{ id: string; type: string; label: string; parentId?: string; description?: string }>;
  edges: Array<{ id: string; source: string; target: string; type: string; reason?: string; condition?: string }>;
}) {
  const root = nodes.find((node) => node.type === "hermes_brain");
  const department = nodes.find((node) => node.type === "department");
  const app = nodes.find((node) => node.type === "app");
  const loops = nodes.filter((node) => node.type === "loop");
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const semanticFlows = edges.filter((edge) => !["routes", "owns", "contains"].includes(edge.type));
  return (
    <div className="space-y-5 py-3">
      <div className="overflow-x-auto">
        <div className="flex min-w-[46rem] items-center gap-3">
          <GraphNode label={root?.label ?? "Hermes Brain"} tone="dark" />
          <Arrow />
          <GraphNode label={department?.label ?? "Department"} />
          <Arrow />
          <GraphNode label={app?.label ?? "Installed App"} tone="app" />
          <Arrow />
          <div className="grid gap-2 sm:grid-cols-2">
            {loops.map((loop) => <GraphNode key={loop.id} label={loop.label} compact />)}
          </div>
        </div>
      </div>
      {semanticFlows.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Evidence and routing contract</h3>
          <ol className="mt-3 space-y-2">
            {semanticFlows.map((edge) => (
              <li className="grid gap-2 rounded-lg border border-line bg-paper/30 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] sm:items-center" key={edge.id}>
                <span className="font-semibold">{nodeById.get(edge.source)?.label ?? edge.source}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-signal sm:text-center">{flowLabel(edge.type)}</span>
                <span className="font-semibold sm:text-right">{nodeById.get(edge.target)?.label ?? edge.target}</span>
                <span className="text-xs leading-5 text-ink/50 sm:col-span-3">{edge.reason}{edge.condition ? ` Condition: ${edge.condition}` : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function flowLabel(type: string): string {
  if (type === "evidence_in") return "evidence enters";
  if (type === "supports") return "may support";
  if (type === "produces") return "produces";
  return "learning returns";
}

function GraphNode({ label, tone = "light", compact = false }: { label: string; tone?: "light" | "dark" | "app"; compact?: boolean }) {
  const style = tone === "dark" ? "border-ink bg-ink text-white" : tone === "app" ? "border-signal bg-orange-50 text-ink" : "border-line bg-white text-ink";
  return <div className={`shrink-0 rounded-lg border px-4 py-3 text-center text-xs font-semibold ${compact ? "w-36" : "w-40"} ${style}`}>{label}</div>;
}

function Arrow() { return <span aria-hidden="true" className="text-xl text-ink/30">→</span>; }
