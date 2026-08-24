import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { marketplaceAppSchema } from "loopgraph/core";
import type { MarketplaceSearchEntry } from "@/lib/app-platform/read-model";
import { MarketplaceAppCard, historicalPreviewLabel, maturityEvidenceLabel } from "./marketplace-app-card";

describe("MarketplaceAppCard", () => {
  it("shows the buyer contract and opens an existing installation directly", () => {
    const app = marketplaceAppSchema.parse({
      schemaVersion: "loopgraph-marketplace/v1alpha1",
      id: "loopgraph.sales.qualify-route-inbound-leads",
      name: "Qualify and Route Inbound Leads",
      summary: "Qualify inbound demand and route clear cases safely.",
      description: "A complete Sales application.",
      department: "sales",
      publisher: { id: "loopgraph", name: "Loopgraph", verified: true },
      visibility: "official",
      tags: ["sales"],
      latestVersion: "1.0.0",
      searchTerms: ["qualify leads"],
      versions: [{
        schemaVersion: "loopgraph-marketplace/v1alpha1",
        appId: "loopgraph.sales.qualify-route-inbound-leads",
        version: "1.0.0",
        digest: `sha256:${"a".repeat(64)}`,
        publishedAt: "2026-08-20T00:00:00.000Z",
        compatibility: { loopgraph: "*", hermes: "*", platforms: ["darwin", "linux", "win32"] },
        dependencies: [],
        permissions: [
          { capability: "crm.lead.read", authority: "read", mode: "required", risk: "low", purpose: "Read leads.", customerFacing: false, defaultPolicy: "allowed", dataClasses: [] },
          { capability: "mail.draft.create", authority: "draft", mode: "optional", risk: "medium", purpose: "Prepare follow-up.", customerFacing: true, defaultPolicy: "approval_required", dataClasses: [] }
        ],
        requiredCapabilities: ["crm.lead.read"],
        optionalCapabilities: ["mail.draft.create"],
        presets: [{ id: "hubspot", name: "HubSpot + Gmail + Slack", description: "Default stack.", path: "presets/hubspot.yaml" }],
        modules: [],
        includedLoopCount: 6,
        preview: { synthetic: true, sampleData: true, historicalReplay: "installed_read_only" },
        maturity: "tested",
        artifactUri: "official://sales/inbound/1.0.0",
        source: {
          sourceId: "loopgraph-official",
          sourceType: "official",
          sourceUri: "official://packs",
          snapshotDigest: `sha256:${"b".repeat(64)}`,
          trustPolicy: "official_only",
          synchronizedAt: "2026-08-20T00:00:00.000Z"
        },
        provenanceVerified: true
      }]
    });
    const entry: MarketplaceSearchEntry = {
      app,
      score: 1,
      matchedTerms: ["qualify", "leads"],
      installation: { id: "installed-sales-app" } as MarketplaceSearchEntry["installation"],
      previewStatus: {
        syntheticAvailable: true,
        sampleDataAvailable: true,
        historicalReplay: "available"
      }
    };

    const html = renderToStaticMarkup(React.createElement(MarketplaceAppCard, { entry }));

    expect(html).toContain("Included loops");
    expect(html).toContain("Required capabilities");
    expect(html).toContain("Optional capabilities");
    expect(html).toContain("Historical preview");
    expect(html).toContain("available now");
    expect(html).toContain('href="/apps/installed-sales-app"');
    expect(html).toContain("tested · no recorded test");
  });

  it("explains maturity from recorded evidence instead of a publisher claim", () => {
    const evidence = {
      passedScenarioCount: 13,
      scenarioCount: 13
    } as Parameters<typeof maturityEvidenceLabel>[0]["maturityEvidence"];
    expect(maturityEvidenceLabel({ maturity: "tested", maturityEvidence: evidence } as Parameters<typeof maturityEvidenceLabel>[0]))
      .toBe("tested · 13/13 synthetic");
    expect(maturityEvidenceLabel({ maturity: "concept" } as Parameters<typeof maturityEvidenceLabel>[0]))
      .toBe("concept · no recorded test");
  });

  it("uses honest historical preview labels", () => {
    expect(historicalPreviewLabel("requires_install")).toBe("after install");
    expect(historicalPreviewLabel("requires_readiness")).toBe("after setup + rehearsal");
    expect(historicalPreviewLabel("available")).toBe("available now");
    expect(historicalPreviewLabel("completed")).toBe("completed");
  });
});
