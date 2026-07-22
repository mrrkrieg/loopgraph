import { describe, expect, it } from "vitest";
import { getAdapterById } from "../sdk/adapters/index";
import {
  googleAdsAdapter,
  hubspotAdapter,
  marketingMvpAdapters,
  manualAdapter,
  notionAdapter,
  slackAdapter
} from "../sdk/adapters/marketing-mvp";
import { allMockAdapters } from "../sdk/adapters/mock-adapters";
import { runAdapterConformance } from "../sdk/conformance";

describe("adapter conformance", () => {
  it("all mock adapters pass", async () => {
    for (const adapter of allMockAdapters) {
      const errors = await runAdapterConformance(adapter);
      expect(errors, adapter.id).toEqual([]);
    }
  });

  it("all local-first Marketing MVP adapters pass", async () => {
    for (const adapter of marketingMvpAdapters) {
      const errors = await runAdapterConformance(adapter);
      expect(errors, adapter.id).toEqual([]);
    }
  });

  it("registers local-first adapter IDs used by Hermes materialized loops and connector manifests", () => {
    for (const id of [
      "manual",
      "manual_file",
      "google_ads",
      "product_analytics",
      "hubspot",
      "notion",
      "local_markdown",
      "webflow",
      "slack"
    ]) {
      expect(getAdapterById(id)?.id).toBe(id);
    }
  });

  it("reads normalized Hermes event fixtures without live credentials", async () => {
    const fixture = {
      simulatedAt: "2026-07-21T12:00:00.000Z",
      subject: { type: "campaign", id: "campaign_123" },
      evidenceRefs: ["fixture:evidence_1"],
      normalizedPayload: {
        signals: { spend: 1200 },
        deal: { id: "deal_123", qualified: true },
        brief: { id: "brief_456", status: "approved" },
        owner: "Growth lead"
      }
    };

    await expect(googleAdsAdapter.readVariable("ads.spend", fixture)).resolves.toMatchObject({
      value: 1200,
      freshness: "fixture",
      trusted: true
    });
    await expect(hubspotAdapter.readVariable("crm.deal", fixture)).resolves.toMatchObject({
      value: { id: "deal_123", qualified: true },
      trusted: true
    });
    await expect(notionAdapter.readVariable("content.brief", fixture)).resolves.toMatchObject({
      value: { id: "brief_456", status: "approved" },
      trusted: true
    });
    await expect(slackAdapter.readVariable("messaging.owner", fixture)).resolves.toMatchObject({
      value: "Growth lead",
      trusted: true
    });
  });

  it("keeps prepared actions local-only and fingerprint-approved", async () => {
    const prepared = await manualAdapter.prepareAction({
      toolKey: "create_review_task",
      payload: { loopId: "marketing_ads", summary: "Review synthetic Ads recommendation." }
    });
    const rejected = await manualAdapter.commitPreparedAction({
      preparedAction: prepared,
      approvedFingerprints: []
    });
    const committed = await manualAdapter.commitPreparedAction({
      preparedAction: prepared,
      approvedFingerprints: [prepared.fingerprint]
    });

    expect(prepared).toMatchObject({
      toolKey: "create_review_task",
      payload: {
        localOnly: true,
        preparedBy: "manual"
      },
      riskLevel: "low",
      requiresApproval: false,
      customerFacing: false
    });
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(committed).toMatchObject({
      status: "mock_committed",
      fingerprint: prepared.fingerprint
    });
  });
});
