import { SectionCard } from "@/components/section-card";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";

export default async function LoopSpecPage({
  params
}: {
  params: Promise<{ loopId: string }>;
}) {
  const { loopId } = await params;
  const { spec } = await getWorkspace(loopId);

  return (
    <div className="grid gap-5">
      <SectionCard title="Goal">
        <SpecText label="Goal" value={spec.goal} />
        <SpecText label="Business outcome" value={spec.businessOutcome} />
        <SpecText label="Target metric" value={spec.targetMetric} />
      </SectionCard>
      <SectionCard title="Work item and cadence">
        <SpecText label="Work item" value={spec.workItem} />
        <SpecText label="Trigger" value={spec.trigger} />
        <SpecText label="Cadence" value={spec.cadence} />
      </SectionCard>
      <SectionCard title="Inputs and data sources">
        <div className="grid gap-3 md:grid-cols-2">
          {spec.inputs.map((input) => (
            <div key={input.name} className="rounded-md border border-line bg-paper p-3">
              <div className="font-medium">{input.name}</div>
              <div className="mt-1 text-sm text-ink/60">{input.description}</div>
            </div>
          ))}
          {spec.dataSources.map((source) => (
            <div key={source.name} className="rounded-md border border-line bg-white p-3">
              <div className="font-medium">{source.name}</div>
              <div className="mt-1 text-sm text-ink/60">{source.type} · {source.purpose}</div>
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Routine">
        <div className="space-y-3">
          {spec.routine.map((step, index) => (
            <div key={step.stepName} className="flex gap-3 rounded-md border border-line bg-paper p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div>
                <div className="font-medium">{step.stepName}</div>
                <div className="text-sm text-ink/60">{step.actor} · {step.description}</div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="Verification and escalation">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            {spec.verification.map((check) => (
              <div key={check.name} className="rounded-md border border-line bg-paper p-3 text-sm">
                <div className="font-medium">{check.description}</div>
                <div className="mt-1 text-ink/55">{check.checkType} · {check.passCriteria}</div>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {spec.escalation.map((rule) => (
              <div key={rule.condition} className="rounded-md border border-line bg-white p-3 text-sm">
                <div className="font-medium">{rule.condition}</div>
                <div className="mt-1 text-ink/55">{rule.severity} · {rule.ownerRole}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Trace, metrics, and management review">
        <div className="grid gap-4 lg:grid-cols-3">
          <pre className="overflow-auto rounded-md bg-ink p-3 text-xs text-white/85">{JSON.stringify(spec.traceSchema, null, 2)}</pre>
          <div className="space-y-2">
            {spec.metrics.map((metric) => (
              <div key={metric.name} className="rounded-md border border-line bg-paper p-3 text-sm">
                <div className="font-medium">{metric.name}</div>
                <div className="text-ink/55">{metric.type} · {metric.source}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2 text-sm">
            {spec.managementReviewOutput.questions.map((question) => (
              <div key={question} className="rounded-md border border-line bg-white p-3">{question}</div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function SpecText({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">{label}</div>
      <div className="mt-1 text-sm leading-6">{value}</div>
    </div>
  );
}
