import React from "react";

type UndefinedMetric = {
  id: string;
  label: string;
  reason?: string;
  requiredAction?: string;
  suggestedIntegration?: string;
};

export function UndefinedMetricsList({ metrics }: { metrics: UndefinedMetric[] }) {
  if (metrics.length === 0) {
    return <div className="rounded-md border border-line bg-paper p-4 text-sm text-ink/60">No undefined metrics in today&apos;s summary.</div>;
  }

  return (
    <div className="space-y-3">
      {metrics.map((metric) => (
        <div className="rounded-md border border-line bg-paper p-4 text-sm" key={metric.id}>
          <div className="font-semibold">{metric.label}</div>
          {metric.reason ? <div className="mt-1 text-ink/60">{metric.reason}</div> : null}
          {metric.requiredAction ? <div className="mt-2 text-ink/70">{metric.requiredAction}</div> : null}
          {metric.suggestedIntegration ? <div className="mt-1 text-ink/55">{metric.suggestedIntegration}</div> : null}
        </div>
      ))}
    </div>
  );
}
