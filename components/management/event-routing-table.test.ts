import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventRoutingTable } from "./event-routing-table";

describe("EventRoutingTable", () => {
  it("renders the company brain event routing table", () => {
    const html = renderToStaticMarkup(React.createElement(EventRoutingTable));

    expect(html).toContain("Event Type");
    expect(html).toContain("campaign_performance_drop");
    expect(html).toContain("Customer Success Department Loop");
  });
});
