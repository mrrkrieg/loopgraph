import { describe, expect, it } from "vitest";
import { installedAppPresentation, privateAppPublisherPrompt } from "./private-app-handoff";

describe("private App browser handoff", () => {
  it("keeps a normal installation labeled as the upstream App", () => {
    expect(installedAppPresentation({
      appName: "Qualify and Route Inbound Leads",
      installationId: "install.sales"
    })).toEqual({
      title: "Qualify and Route Inbound Leads",
      kind: "installed",
      kindLabel: "Installed App",
      description: "Operate, measure, and improve this installed business capability."
    });
  });

  it("names a private derivative and produces a bounded Hermes publishing handoff", () => {
    const presentation = installedAppPresentation({
      appName: "Qualify and Route Inbound Leads",
      installationId: "install.private-sales",
      derivation: {
        derivedAppId: "acme.sales.qualify-leads",
        upstreamAppId: "loopgraph.sales.qualify-route-inbound-leads",
        upstreamVersion: "1.0.0",
        upstreamDigest: `sha256:${"a".repeat(64)}`,
        parentInstallationId: "install.sales",
        createdAt: "2026-08-22T12:00:00.000Z",
        createdBy: "owner@example.com"
      }
    });

    expect(presentation).toMatchObject({
      title: "acme.sales.qualify-leads",
      kind: "private_derived",
      kindLabel: "Private derived App",
      derivation: { upstreamVersion: "1.0.0", createdBy: "owner@example.com" }
    });
    expect(presentation.publisherPrompt).toContain("Capture installed App install.private-sales");
    expect(presentation.publisherPrompt).toContain("Do not sign or publish until I approve");
    expect(privateAppPublisherPrompt("install.private-sales", "acme.sales.qualify-leads")).not.toContain("secret");
  });
});
