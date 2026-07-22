import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscoveryStepNav } from "./discovery-step-nav";

describe("DiscoveryStepNav", () => {
  it("preserves a selected Hermes/browser discovery session across steps", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiscoveryStepNav, {
        activeHref: "/discovery/departments",
        sessionId: "session_browser_1"
      })
    );

    expect(html).toContain("/discovery?sessionId=session_browser_1");
    expect(html).toContain("/discovery/departments?sessionId=session_browser_1");
    expect(html).toContain("/discovery/designing?sessionId=session_browser_1");
    expect(html).toContain("/discovery/create-loops?sessionId=session_browser_1");
  });
});
