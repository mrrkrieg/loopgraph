import type { AppEvalRun } from "loopgraph/core";

export type MarketplaceHistoricalPreviewStatus =
  | "requires_install"
  | "requires_readiness"
  | "available"
  | "completed";

export function deriveMarketplaceHistoricalPreviewStatus(input: {
  installed: boolean;
  connectionsReady: boolean;
  evaluations: Array<Pick<AppEvalRun, "level" | "status">>;
}): MarketplaceHistoricalPreviewStatus {
  if (!input.installed) return "requires_install";
  if (input.evaluations.some((evaluation) =>
    evaluation.level === "historical_replay" && evaluation.status === "passed"
  )) return "completed";
  const conformancePassed = input.evaluations.some((evaluation) =>
    evaluation.level === "synthetic" && evaluation.status === "passed"
  );
  if (input.connectionsReady && conformancePassed) return "available";
  return "requires_readiness";
}
