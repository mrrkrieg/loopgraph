import type { LoopRunTrace } from "../core/trace";

export type RunIndex = { id: string; loopId: string; status: string };

const HERO_LOOP_ALIASES: Record<string, string[]> = {
  "github-issue-triage": [
    "github-issue-triage",
    "loop_demo_marketing_campaign",
    "catalog_github-issue-triage"
  ],
  "strategic-account-escalation": [
    "strategic-account-escalation",
    "catalog_strategic-account-escalation"
  ]
};

const LEGACY_LOOP_TO_HERO: Record<string, string> = {
  loop_demo_marketing_campaign: "github-issue-triage",
  loop_demo_sales_pipeline: "sales-follow_up",
  loop_demo_product_discovery: "product-feedback_to_problem",
  loop_demo_customer_health: "customer_success-customer_health_risk",
  loop_demo_engineering_quality: "engineering-qa_checklist",
  loop_demo_ops_efficiency: "operations_finance-approval_bottleneck",
  loop_demo_people_engagement: "hr-manager_coaching",
  loop_demo_risk_compliance: "legal_security-policy_drift"
};

function slugLoopId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** All loop IDs that refer to the same logical loop (catalog, hero spec, legacy demo). */
export function resolveLoopIdAliases(loopId: string): string[] {
  const ids = new Set<string>([loopId]);

  if (loopId.startsWith("catalog_")) {
    ids.add(loopId.slice("catalog_".length));
  } else if (!loopId.startsWith("loop_")) {
    ids.add(`catalog_${slugLoopId(loopId)}`);
  }

  const heroFromLegacy = LEGACY_LOOP_TO_HERO[loopId];
  if (heroFromLegacy) {
    for (const alias of resolveLoopIdAliases(heroFromLegacy)) {
      ids.add(alias);
    }
  }

  for (const aliases of Object.values(HERO_LOOP_ALIASES)) {
    if (aliases.includes(loopId)) {
      for (const alias of aliases) {
        ids.add(alias);
        if (alias.startsWith("catalog_")) {
          ids.add(alias.slice("catalog_".length));
        }
      }
    }
  }

  for (const [hero, aliases] of Object.entries(HERO_LOOP_ALIASES)) {
    if (ids.has(hero)) {
      for (const alias of aliases) {
        ids.add(alias);
      }
    }
  }

  return Array.from(ids);
}

export function loopIdsMatch(left: string, right: string): boolean {
  const leftAliases = new Set(resolveLoopIdAliases(left));
  return resolveLoopIdAliases(right).some((id) => leftAliases.has(id));
}

/** Match runs page / API filtering: hero spec loopIds vs Design Studio loop_demo_* ids. */
export function filterRunsForLoop(runs: RunIndex[], pageLoopId: string): RunIndex[] {
  const aliases = new Set(resolveLoopIdAliases(pageLoopId));
  if (pageLoopId.startsWith("loop_") && !aliases.has(pageLoopId)) {
    return runs;
  }

  return runs.filter((run) => aliases.has(run.loopId));
}

export function filterCasesForLoop<T extends { sourceLoopId: string }>(
  cases: T[],
  pageLoopId: string
): T[] {
  return cases.filter((caseItem) => loopIdsMatch(caseItem.sourceLoopId, pageLoopId));
}

export function describeTraceMode(trace: LoopRunTrace): {
  mode: string;
  source: string;
  writes: string;
  variant: "simulate" | "execute" | "other";
} {
  if (trace.mode === "execute") {
    return {
      mode: "execute",
      source: "live integrations",
      writes: "enabled after approval",
      variant: "execute"
    };
  }

  if (trace.mode === "simulate") {
    return {
      mode: "simulate",
      source: "fixture",
      writes: "none (mock_committed only after approval)",
      variant: "simulate"
    };
  }

  return {
    mode: trace.mode,
    source: "unknown",
    writes: "unknown",
    variant: "other"
  };
}
