import { describe, expect, it } from "vitest";
import { getEdgeEndpoints } from "./graph-geometry";
import type { BrainGraphNode } from "./graph-types";

describe("graph geometry", () => {
  it("attaches edge endpoints to node circle boundaries", () => {
    const source = brainNode({ id: "a", x: 0, y: 0, radius: 20 });
    const target = brainNode({ id: "b", x: 100, y: 0, radius: 30 });
    const endpoints = getEdgeEndpoints({ source, target });

    expect(endpoints).toEqual({ x1: 20, y1: 0, x2: 70, y2: 0 });
  });

  it("returns null for missing coordinates", () => {
    const endpoints = getEdgeEndpoints({
      source: brainNode({ id: "a", x: undefined, y: 0 }),
      target: brainNode({ id: "b", x: 10, y: 10 })
    });

    expect(endpoints).toBeNull();
  });
});

function brainNode(overrides: Partial<BrainGraphNode>): BrainGraphNode {
  return {
    id: overrides.id ?? "node",
    type: overrides.type ?? "workflow_loop",
    label: overrides.label ?? "Node",
    status: overrides.status ?? "ready",
    radius: overrides.radius ?? 20,
    color: overrides.color ?? "#fff",
    stroke: overrides.stroke ?? "#111",
    x: overrides.x,
    y: overrides.y
  };
}
