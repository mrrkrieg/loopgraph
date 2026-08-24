import { describe, expect, it } from "vitest";
import { primaryNav } from "./primary-sidebar";
import HomePage from "../../app/page";
import TopologyPage from "../../app/topology/page";

describe("primary navigation", () => {
  it("leads with applications and keeps primitives under Advanced", () => {
    expect(primaryNav.map((item) => item.label)).toEqual([
      "Marketplace",
      "Installed Apps",
      "Company Graph",
      "Activity",
      "Connections",
      "Build",
      "Settings",
      "Advanced"
    ]);
    expect(primaryNav.map((item) => item.href)).toEqual([
      "/marketplace",
      "/apps",
      "/brain",
      "/operate",
      "/settings/integrations",
      "/discovery",
      "/settings",
      "/advanced"
    ]);
  });

  it("redirects root and topology into Brain", () => {
    expect(() => HomePage()).toThrow();
    expect(() => TopologyPage()).toThrow();
  });
});
