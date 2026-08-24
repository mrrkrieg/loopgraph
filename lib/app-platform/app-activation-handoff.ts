import type {
  AppActivationApprovalReceipt,
  AppRolloutMode,
  WorkspaceAppInstallation
} from "loopgraph/core";

export type BrowserActivationMode = Extract<AppRolloutMode, "shadow" | "recommend">;

export function currentActivationApproval(input: {
  installation: WorkspaceAppInstallation;
  approvals: AppActivationApprovalReceipt[];
  mode: BrowserActivationMode;
  now?: Date;
}): AppActivationApprovalReceipt | undefined {
  const now = (input.now ?? new Date()).getTime();
  return input.approvals
    .filter((approval) =>
      "activationGate" in approval &&
      !approval.consumedAt &&
      Date.parse(approval.expiresAt) > now &&
      approval.installationId === input.installation.id &&
      approval.appId === input.installation.appId &&
      approval.artifactDigest === input.installation.artifactDigest &&
      approval.fromState === input.installation.state &&
      approval.requestedMode === input.mode
    )
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt))[0];
}

export function activationEvidenceRefs(evidenceRefs: string[]): string[] {
  return [...new Set(evidenceRefs)]
    .filter((reference) => reference.length > 0 && reference.length <= 1_000)
    .slice(0, 100);
}
