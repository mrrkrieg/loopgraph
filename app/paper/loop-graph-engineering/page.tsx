import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { PaperArticle } from "@/components/paper/paper-article";
import { isHostedPreview } from "@/lib/hosted-preview";

export const metadata: Metadata = {
  title: "Loop Graph Engineering with Hermes Agent · Loopgraph",
  description:
    "Why the future company will be a graph of governed loops, with Hermes Agent routing work and Loopgraph making it safe to run.",
  openGraph: {
    title: "Loop Graph Engineering with Hermes Agent",
    description:
      "A governed operating model for how companies receive signals, route work, act safely, and learn from outcomes.",
    images: ["/paper/01-loop-graph-engineering-cover.png"],
    type: "article"
  },
  twitter: {
    card: "summary_large_image",
    title: "Loop Graph Engineering with Hermes Agent",
    description:
      "The future company will be a graph of governed loops.",
    images: ["/paper/01-loop-graph-engineering-cover.png"]
  }
};

export default async function LoopGraphEngineeringPaperPage() {
  if (!isHostedPreview()) {
    notFound();
  }

  const markdown = await readFile(
    path.join(
      process.cwd(),
      "content",
      "loop-graph-engineering-with-hermes-agent.md"
    ),
    "utf8"
  );

  return <PaperArticle markdown={markdown} />;
}
