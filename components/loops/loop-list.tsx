import React from "react";
import Link from "next/link";
import { titleCase } from "../../lib/loop-engineering-builder/demo-helpers";
import type { LoopRecord } from "../../lib/loop-engineering-builder/types";

export function LoopList({
  loops,
  selectedLoopId
}: {
  loops: LoopRecord[];
  selectedLoopId: string;
}) {
  return (
    <div className="space-y-2">
      {loops.map((loop) => {
        const selected = loop.id === selectedLoopId;
        return (
          <Link
            aria-current={selected ? "true" : undefined}
            className={`block rounded-md border p-3 text-sm transition ${
              selected ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink"
            }`}
            href={`/loops?preview=${loop.id}`}
            key={loop.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{loop.name}</div>
                <div className={`mt-1 text-xs ${selected ? "text-white/65" : "text-ink/50"}`}>
                  {titleCase(loop.department)}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  selected ? "border-white/35 bg-white/10 text-white" : "border-ink/10 bg-sage/20 text-ink"
                }`}
              >
                {titleCase(loop.status)}
              </span>
            </div>
            <div className={`mt-3 text-xs leading-5 ${selected ? "text-white/65" : "text-ink/55"}`}>
              {loop.targetMetric}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
