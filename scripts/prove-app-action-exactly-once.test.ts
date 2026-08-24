import { describe, expect, it } from "vitest";
import {
  appActionExactlyOnceProofSchema,
  proveAppActionExactlyOnce,
  verifyAppActionExactlyOnceProof
} from "./prove-app-action-exactly-once";

describe("App action exactly-once release proof", () => {
  it("recovers the original Broker receipt without repeating the provider fixture mutation", async () => {
    const receipt = await proveAppActionExactlyOnce({
      sourceCommitSha: "b".repeat(40),
      checkedAt: new Date("2026-08-21T20:00:00.000Z")
    });

    expect(receipt).toMatchObject({
      schemaVersion: "app-action-exactly-once-proof/v1",
      sourceCommitSha: "b".repeat(40),
      checkedAt: "2026-08-21T20:00:00.000Z",
      fixture: { networkAccess: false, credentialAccess: false },
      proof: {
        providerInvocationCount: 1,
        originalCommitCalls: 1,
        reconciliationCalls: 1,
        replayCommitCalls: 1,
        appCommitRequestedEvents: 1,
        appTerminalEventsBeforeReconciliation: 0,
        appTerminalEventsAfterReconciliation: 1,
        reconciliationStatus: "resolved",
        preparedActionStatus: "committed",
        replayReturnedOriginalReceipt: true
      },
      outcome: "passed"
    });
    expect(appActionExactlyOnceProofSchema.parse(receipt)).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toContain("Approved fixture message");
    expect(JSON.stringify(receipt)).not.toContain("credentialRef");
    expect(receipt.proofDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => verifyAppActionExactlyOnceProof({
      ...receipt,
      checkedAt: "2026-08-21T20:00:01.000Z"
    })).toThrow(/digest does not match/i);
  });

  it("rejects a proof that is not bound to one source commit", async () => {
    await expect(proveAppActionExactlyOnce({
      sourceCommitSha: "not-a-commit",
      checkedAt: new Date("2026-08-21T20:00:00.000Z")
    })).rejects.toThrow();
  });
});
