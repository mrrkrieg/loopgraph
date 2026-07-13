import React from "react";
import { StatusPill } from "../status-pill";

export function DailyLoopCard({
  loopName,
  status,
  metric,
  nextAction
}: {
  loopName: string;
  status: string;
  metric?: string;
  nextAction: string;
}) {
  return (
    <article className="rounded-md border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{loopName}</h3>
        <StatusPill>{status}</StatusPill>
      </div>
      <div className="mt-3 text-sm text-ink/60">{metric ?? "No primary metric"}</div>
      <div className="mt-2 text-sm leading-6 text-ink/70">{nextAction}</div>
    </article>
  );
}
