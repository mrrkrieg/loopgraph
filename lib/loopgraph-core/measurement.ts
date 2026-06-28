export type HiddenLaborInput = {
  reviewMinutes?: number;
  reworkMinutes?: number;
  botsittingMinutes?: number;
  escalationMinutes?: number;
  governanceMinutes?: number;
  grossSavedMinutes?: number;
};

export type NetSavingsResult = {
  grossSavedMinutes: number;
  observedCostMinutes: number;
  netSavedMinutes: number;
  labels: {
    grossSaved: "modeled_estimate" | "observed";
    review: "observed";
    rework: "observed";
    botsitting: "observed";
    escalation: "observed";
    governance: "observed";
  };
};

export function calculateNetSavings(input: HiddenLaborInput): NetSavingsResult {
  const grossSavedMinutes = input.grossSavedMinutes ?? 0;
  const reviewMinutes = input.reviewMinutes ?? 0;
  const reworkMinutes = input.reworkMinutes ?? 0;
  const botsittingMinutes = input.botsittingMinutes ?? 0;
  const escalationMinutes = input.escalationMinutes ?? 0;
  const governanceMinutes = input.governanceMinutes ?? 0;
  const observedCostMinutes = reviewMinutes + reworkMinutes + botsittingMinutes + escalationMinutes + governanceMinutes;

  return {
    grossSavedMinutes,
    observedCostMinutes,
    netSavedMinutes: grossSavedMinutes - observedCostMinutes,
    labels: {
      grossSaved: input.grossSavedMinutes === undefined ? "modeled_estimate" : "observed",
      review: "observed",
      rework: "observed",
      botsitting: "observed",
      escalation: "observed",
      governance: "observed"
    }
  };
}

export function scoreLoopHealth(netSavedMinutes: number) {
  if (netSavedMinutes >= 120) return "Excellent";
  if (netSavedMinutes >= 30) return "Good";
  if (netSavedMinutes >= 0) return "Marginal";
  return "Negative net value";
}
