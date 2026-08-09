import Link from "next/link";
import { PageHeader } from "@/components/page-header";

const advancedSections = [
  { href: "/loops", title: "LoopSpecs", description: "Inspect individual loop contracts, fixtures, runs, reviews, and implementation artifacts." },
  { href: "/management", title: "Management operations", description: "Review Hermes routing receipts, escalations, human choices, and unresolved company problems." },
  { href: "/daily", title: "Daily operating summary", description: "Inspect low-level loop metrics, missing bindings, and operating rollups." },
  { href: "/operate/controller", title: "Continuous-improvement controller", description: "Operate bounded evidence scans, controller policy, and graph change proposals." },
  { href: "/paper/loop-graph-engineering", title: "Architecture paper", description: "Read the technical model behind event routing, governed loops, and evidence returns." }
] as const;

export default function AdvancedPage() {
  return (
    <>
      <PageHeader
        eyebrow="Technical operations"
        title="Advanced"
        description="Application-level workflows are the default. Use these views when you need the underlying LoopSpecs, route jobs, controller operations, receipts, and technical contracts."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {advancedSections.map((section) => (
          <Link className="rounded-xl border border-line bg-white p-5 shadow-sm hover:border-ink" href={section.href} key={section.href}>
            <h2 className="font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm leading-6 text-ink/60">{section.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
