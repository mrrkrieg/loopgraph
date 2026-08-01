"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const operateNavItems = [
  {
    href: "/operate/activity",
    label: "Agent activity",
    description: "What is running now"
  },
  {
    href: "/operate/opportunities",
    label: "Opportunities",
    description: "What Hermes found"
  },
  {
    href: "/operate/changes",
    label: "Change review",
    description: "What changes next"
  },
  {
    href: "/operate/controller",
    label: "Controller",
    description: "Why Hermes acted"
  },
  {
    href: "/operate/learning",
    label: "Learning",
    description: "What evidence says"
  },
  {
    href: "/operate/value",
    label: "Value",
    description: "What the loops returned"
  }
] as const;

export function OperateNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Operate Loopgraph" className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {operateNavItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-3 transition ${
              active
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink hover:border-ink"
            }`}
            href={item.href}
            key={item.href}
          >
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className={`mt-1 block text-xs ${active ? "text-white/65" : "text-ink/50"}`}>
              {item.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
