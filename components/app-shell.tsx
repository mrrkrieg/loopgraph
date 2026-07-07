"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LoopgraphMark } from "./loopgraph-mark";

const navItems = [
  { href: "/discovery", label: "Discovery" },
  { href: "/daily", label: "Daily" },
  { href: "/topology", label: "Topology" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/loops", label: "Loops" },
  { href: "/loops/new", label: "New Loop" },
  { href: "/management", label: "Management" },
  { href: "/templates", label: "Templates" },
  { href: "/skills", label: "Skills" },
  { href: "/access-plan", label: "Access Plan" },
  { href: "/settings", label: "Settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTopology = pathname === "/topology";
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);

  useEffect(() => {
    setIsNavCollapsed(window.localStorage.getItem("loopgraph-nav-collapsed") === "true");
  }, []);

  function toggleNavigation() {
    setIsNavCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("loopgraph-nav-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 hidden border-r border-line bg-white py-5 transition-[width] duration-200 lg:block ${
          isNavCollapsed ? "w-20 px-3" : "w-64 px-4"
        }`}
      >
        <div className={`flex items-center gap-2 ${isNavCollapsed ? "justify-center" : "justify-between"}`}>
          <Link
            aria-label="Loopgraph topology"
            className={`flex min-w-0 items-center rounded-md border border-line bg-white text-ink ${
              isNavCollapsed ? "justify-center p-3" : "gap-3 px-3 py-3"
            }`}
            href="/topology"
          >
            <LoopgraphMark className="h-9 w-9 shrink-0" />
            {!isNavCollapsed ? (
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-wide">Loopgraph</div>
                <div className="mt-1 text-xs text-ink/55">Company loops, verified</div>
              </div>
            ) : null}
          </Link>
          {!isNavCollapsed ? (
            <button
              aria-label="Collapse navigation"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink/65 hover:border-ink hover:text-ink"
              data-testid="nav-collapse-toggle"
              onClick={toggleNavigation}
              type="button"
            >
              <ChevronLeftIcon />
            </button>
          ) : null}
        </div>
        {isNavCollapsed ? (
          <button
            aria-label="Expand navigation"
            className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-line text-ink/65 hover:border-ink hover:text-ink"
            data-testid="nav-expand-toggle"
            onClick={toggleNavigation}
            type="button"
          >
            <ChevronRightIcon />
          </button>
        ) : null}
        <nav className="mt-6 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-label={isNavCollapsed ? item.label : undefined}
              className={`block rounded-md text-sm font-medium text-ink/75 hover:bg-ink hover:text-white ${
                isNavCollapsed ? "px-2 py-2 text-center" : "px-3 py-2"
              } ${pathname === item.href ? "bg-paper text-ink" : ""}`}
              title={isNavCollapsed ? item.label : undefined}
            >
              {isNavCollapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className={`transition-[padding] duration-200 ${isNavCollapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-3 backdrop-blur lg:hidden">
          <Link href="/topology" className="flex items-center gap-2 font-semibold">
            <LoopgraphMark className="h-7 w-7" />
            Loopgraph
          </Link>
        </header>
        <main
          className={`${
            isTopology
              ? "max-w-none lg:flex lg:h-screen lg:flex-col lg:overflow-hidden"
              : "mx-auto max-w-7xl"
          } px-5 py-6 sm:px-8`}
        >
          {!process.env.NEXT_PUBLIC_SUPABASE_URL && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Demo mode — data resets on refresh. Configure Supabase env vars for Design Studio persistence.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M14.5 6.5 9 12l5.5 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="m9.5 6.5 5.5 5.5-5.5 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
