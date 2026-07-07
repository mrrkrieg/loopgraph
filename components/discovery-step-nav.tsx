import Link from "next/link";
import { discoverySteps } from "@/app/discovery/view-data";

export function DiscoveryStepNav({ activeHref }: { activeHref: string }) {
  return (
    <div className="mb-6 overflow-x-auto border-b border-line pb-3">
      <nav className="flex min-w-max gap-2">
        {discoverySteps.map((step, index) => (
          <Link
            key={step.href}
            href={step.href}
            className={`rounded-md border px-3 py-2 text-xs font-semibold ${
              activeHref === step.href
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink/65 hover:border-ink hover:text-ink"
            }`}
          >
            {index + 1}. {step.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

