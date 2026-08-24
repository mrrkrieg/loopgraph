import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getViewData: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); })
}));

vi.mock("@/lib/app-platform/read-model", () => ({
  getAppInstallPlanViewData: mocks.getViewData
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect
}));
vi.mock("@/components/apps/install-wizard", () => ({
  InstallWizard: ({ app }: { app: { preset: { id: string } } }) => React.createElement("div", { "data-testid": "install-wizard", "data-preset": app.preset.id }, "Install wizard")
}));

import AppInstallPlanPage from "./page";

describe("Marketplace App browser install entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("presents declared stacks when an App-only URL has no saved preset", async () => {
    mocks.getViewData.mockResolvedValue({
      detail: appDetail(),
      journey: { stage: "choose_preset", app: { presets: [] } }
    });

    const page = await AppInstallPlanPage({
      params: Promise.resolve({ appId: "loopgraph.sales.qualify-route-inbound-leads" }),
      searchParams: Promise.resolve({})
    });
    const html = renderToStaticMarkup(page);

    expect(mocks.getViewData).toHaveBeenCalledWith("loopgraph.sales.qualify-route-inbound-leads", undefined);
    expect(html).toContain("How should Qualify and Route Inbound Leads connect?");
    expect(html).toContain("HubSpot + Gmail + Slack");
    expect(html).toContain("Salesforce + Outlook + Teams");
    expect(html).not.toContain("Install wizard");
  });

  it("opens the wizard directly when the shared journey resolves a saved preset", async () => {
    mocks.getViewData.mockResolvedValue({
      detail: appDetail(),
      journey: { stage: "connect_systems", app: { presetId: "hubspot-gmail-slack" }, questions: [] },
      plan: { presetId: "hubspot-gmail-slack" },
      impact: {},
      mappingPlan: { requirements: [] }
    });

    const page = await AppInstallPlanPage({
      params: Promise.resolve({ appId: "loopgraph.sales.qualify-route-inbound-leads" }),
      searchParams: Promise.resolve({})
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Install wizard");
    expect(html).toContain("data-preset=\"hubspot-gmail-slack\"");
  });

  it("sends an already installed App to its operating view", async () => {
    mocks.getViewData.mockResolvedValue({
      detail: appDetail(),
      journey: { installationId: "installed.sales", stage: "operate" }
    });

    await expect(AppInstallPlanPage({
      params: Promise.resolve({ appId: "loopgraph.sales.qualify-route-inbound-leads" }),
      searchParams: Promise.resolve({})
    })).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/apps/installed.sales");
  });
});

function appDetail() {
  return {
    app: {
      id: "loopgraph.sales.qualify-route-inbound-leads",
      name: "Qualify and Route Inbound Leads",
      summary: "Govern inbound lead qualification.",
      department: "sales"
    },
    manifest: {
      modules: [],
      presets: [
        { id: "hubspot-gmail-slack", name: "HubSpot + Gmail + Slack", description: "Use the default HubSpot stack." },
        { id: "salesforce-outlook-teams", name: "Salesforce + Outlook + Teams", description: "Use the Microsoft stack." }
      ]
    },
    setupQuestions: []
  };
}
