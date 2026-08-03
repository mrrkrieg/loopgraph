import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { PaperArticle } from "@/components/paper/paper-article";
import { isHostedPreview } from "@/lib/hosted-preview";

export const metadata: Metadata = {
  title: "Loop Graph Engineering: The Operating System for AI-Run Companies · Loopgraph",
  description:
    "How Hermes turns company signals into decisions and Loopgraph turns those decisions into governed, measurable operations.",
  openGraph: {
    title: "Loop Graph Engineering: The Operating System for AI-Run Companies",
    description:
      "The future company is not one enormous agent. It is a living graph of governed loops.",
    images: ["/paper/01-loop-graph-engineering-cover-hd.png"],
    type: "article"
  },
  twitter: {
    card: "summary_large_image",
    title: "Loop Graph Engineering: The Operating System for AI-Run Companies",
    description:
      "How Hermes and Loopgraph turn AI reasoning into accountable company operations.",
    images: ["/paper/01-loop-graph-engineering-cover-hd.png"]
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
