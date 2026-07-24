"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PrimarySidebar } from "./layout/primary-sidebar";
import { LoopgraphMark } from "./loopgraph-mark";
import { PreviewGithubBanner } from "./preview-github-banner";

export function AppShell({
  children,
  showPreviewFeatures,
  workspaceBanner
}: {
  children: React.ReactNode;
  showPreviewFeatures: boolean;
  workspaceBanner: React.ReactNode;
}) {
  const pathname = usePathname();
  const isCanvasPage = pathname === "/brain";
  const isPaperPage = pathname.startsWith("/paper/");
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);

  useEffect(() => {
    setIsNavCollapsed(window.localStorage.getItem("loopgraph-nav-collapsed") === "true");
  }, []);

  useEffect(() => {
    if (!isCanvasPage) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCanvasPage]);

  function toggleNavigation() {
    setIsNavCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("loopgraph-nav-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen">
      <PrimarySidebar
        isCollapsed={isNavCollapsed}
        onToggle={toggleNavigation}
        showPreviewFeatures={showPreviewFeatures}
      />
      <div
        className={`transition-[padding] duration-200 ${isNavCollapsed ? "lg:pl-20" : "lg:pl-64"} ${
          isCanvasPage ? "lg:h-[100dvh] lg:overflow-hidden" : ""
        }`}
      >
        {showPreviewFeatures ? <PreviewGithubBanner /> : null}
        <header
          className={`sticky z-20 flex items-center justify-between border-b border-line bg-white/95 px-5 py-3 backdrop-blur lg:hidden ${
            showPreviewFeatures ? "top-10" : "top-0"
          }`}
        >
          <Link href="/brain" className="flex items-center gap-2 font-semibold">
            <LoopgraphMark className="h-7 w-7" />
            Loopgraph
          </Link>
          {showPreviewFeatures ? (
            <Link
              className="text-sm font-semibold text-ink/70 hover:text-ink"
              href="/paper/loop-graph-engineering"
            >
              Paper
            </Link>
          ) : null}
        </header>
        <main
          className={`${
            isCanvasPage
              ? `flex max-w-none flex-col gap-3 overflow-hidden px-3 py-3 sm:px-4 lg:min-h-0 ${
                  showPreviewFeatures ? "lg:h-[calc(100dvh-2.5rem)]" : "lg:h-full"
                }`
              : "mx-auto max-w-7xl px-5 py-6 sm:px-8"
          }`}
        >
          {!isPaperPage ? workspaceBanner : null}
          {!isPaperPage && !process.env.NEXT_PUBLIC_SUPABASE_URL ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Demo mode — data resets on refresh. Configure Supabase env vars for
              Design Studio persistence.
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
