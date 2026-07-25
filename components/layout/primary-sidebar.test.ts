import { describe, expect, it } from "vitest";
import { primaryNav } from "./primary-sidebar";
import HomePage from "../../app/page";
import TopologyPage from "../../app/topology/page";

describe("primary navigation", () => {
  it("contains only Hermes Brain, Management, Loops, and Daily", () => {
    expect(primaryNav.map((item) => item.label)).toEqual([
      "Hermes Brain",
      "Management",
      "Loops",
      "Daily"
    ]);
    expect(primaryNav.map((item) => item.href)).toEqual([
      "/brain",
      "/management",
      "/loops",
      "/daily"
    ]);
  });

  it("redirects root and topology into Brain", () => {
    expect(() => HomePage()).toThrow();
    expect(() => TopologyPage()).toThrow();
  });
});
