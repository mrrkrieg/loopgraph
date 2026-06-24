import { MetricCard } from "@/components/metric-card";
import { SectionCard } from "@/components/section-card";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopMetricsPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const workspace = await getWorkspace(loopId);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        {workspace.metrics.map((metric) => (
          <MetricCard key={metric.name} label={metric.name} value={metric.value} note={metric.note} />
        ))}
      </div>
      <SectionCard title="Measurement plan">
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(workspace.spec.measurementPlan).map(([key, value]) => (
            <div key={key} className="rounded-md border border-line bg-paper p-3 text-sm">
              <div className="font-semibold">{key}</div>
              <div className="mt-1 text-ink/60">{value}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
