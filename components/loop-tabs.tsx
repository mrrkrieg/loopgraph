import Link from "next/link";

const tabs = [
  { href: "", label: "Overview" },
  { href: "/questions", label: "Questions" },
  { href: "/spec", label: "Spec" },
  { href: "/implementation", label: "Implementation" },
  { href: "/runs", label: "Runs" },
  { href: "/reviews", label: "Reviews" },
  { href: "/metrics", label: "Metrics" },
  { href: "/improvements", label: "Improvements" }
];

export function LoopTabs({ loopId }: { loopId: string }) {
  return (
    <div className="mb-6">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink/50">Design Studio</p>
      <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.href || "overview"}
          href={`/loops/${loopId}${tab.href}`}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink/70 hover:border-ink hover:text-ink"
        >
          {tab.label}
        </Link>
      ))}
      </div>
    </div>
  );
}
