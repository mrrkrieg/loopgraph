import React from "react";

export function DailyMetricCard({
  label,
  value,
  note
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-ink/45">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {note ? <div className="mt-2 text-xs leading-5 text-ink/55">{note}</div> : null}
    </div>
  );
}
