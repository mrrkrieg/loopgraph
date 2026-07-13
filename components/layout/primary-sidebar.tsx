"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoopgraphMark } from "../loopgraph-mark";

export const primaryNav = [
  { href: "/brain", label: "Brain", description: "Company graph" },
  { href: "/management", label: "Management", description: "Company brain" },
  { href: "/loops", label: "Loops", description: "Loop definitions" },
  { href: "/daily", label: "Daily", description: "Operating summary" }
] as const;

export function PrimarySidebar({
  isCollapsed,
  onToggle
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`fixed inset-y-0 left-0 hidden border-r border-line bg-white py-5 transition-[width] duration-200 lg:block ${
        isCollapsed ? "w-20 px-3" : "w-64 px-4"
      }`}
    >
      <div className={`flex items-center gap-2 ${isCollapsed ? "justify-center" : "justify-between"}`}>
        <Link
          aria-label="Loopgraph brain"
          className={`flex min-w-0 items-center rounded-md border border-line bg-white text-ink ${
            isCollapsed ? "justify-center p-3" : "gap-3 px-3 py-3"
          }`}
          href="/brain"
        >
          <LoopgraphMark className="h-9 w-9 shrink-0" />
          {!isCollapsed ? (
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-wide">Loopgraph</div>
              <div className="mt-1 text-xs text-ink/55">Company loops, verified</div>
            </div>
          ) : null}
        </Link>
        {!isCollapsed ? (
          <button
            aria-label="Collapse navigation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink/65 hover:border-ink hover:text-ink"
            data-testid="nav-collapse-toggle"
            onClick={onToggle}
            type="button"
          >
            <ChevronLeftIcon />
          </button>
        ) : null}
      </div>
      {isCollapsed ? (
        <button
          aria-label="Expand navigation"
          className="mt-3 flex h-9 w-full items-center justify-center rounded-md border border-line text-ink/65 hover:border-ink hover:text-ink"
          data-testid="nav-expand-toggle"
          onClick={onToggle}
          type="button"
        >
          <ChevronRightIcon />
        </button>
      ) : null}
      <nav className="mt-6 space-y-1">
        {primaryNav.map((item) => {
          const active = pathname === item.href || (item.href !== "/brain" && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={isCollapsed ? item.label : undefined}
              className={`group block rounded-md text-sm font-medium text-ink/75 hover:bg-ink hover:text-white focus:bg-ink focus:text-white ${
                isCollapsed ? "px-2 py-2 text-center" : "px-3 py-2"
              } ${active ? "bg-paper text-ink" : ""}`}
              title={isCollapsed ? item.label : undefined}
            >
              {isCollapsed ? item.label.slice(0, 1) : item.label}
              {!isCollapsed ? (
                <span className="mt-0.5 block text-xs font-normal text-ink/45 group-hover:text-white/75 group-focus:text-white/75">
                  {item.description}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
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
