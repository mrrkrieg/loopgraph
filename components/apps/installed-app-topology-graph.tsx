"use client";

import dynamic from "next/dynamic";
import type { LoopGraphVisual } from "@/lib/loop-engineering-builder/loop-graph-visualization";

const DeferredLoopGraphView = dynamic(
  () => import("@/components/loop-graph-view").then((module) => module.LoopGraphView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-paper text-sm text-ink/50">
        Loading App topology…
      </div>
    )
  }
);

export function InstalledAppTopologyGraph({ graph }: { graph: LoopGraphVisual }) {
  return (
    <div className="h-[340px] sm:h-[460px]">
      <DeferredLoopGraphView
        graph={graph}
        height="100%"
        interactive
        showToggles={false}
        variant="topology"
      />
    </div>
  );
}
