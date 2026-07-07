import { describe, expect, it } from "vitest";
import {
  compactArcLayout,
  descendantIdsByParentId,
  hasCircularOverlap,
  hasClusterOverlap,
  orbitOuterRadius,
  packClusterRows,
  packedOrbitLayout,
  sortByLoopSequence,
  type LoopGraphLayoutNode
} from "./loop-graph-layout";

describe("loop graph layout", () => {
  it("packs dense orbit circles without overlap", () => {
    const nodes = Array.from({ length: 24 }).map((_, index): LoopGraphLayoutNode => ({
      id: `step:test:${index + 1}`,
      kind: index < 6 ? "data_source" : index < 16 ? "action" : index < 20 ? "verification" : "metric",
      label: `Node ${index + 1}`,
      metadata: {
        semanticLayer: index < 6 ? "data" : index < 16 ? "action" : index < 20 ? "verification" : "measurement"
      }
    }));
    const layout = packedOrbitLayout({
      center: { x: 0, y: 0 },
      nodes,
      sizeForNode: () => 74,
      centerSize: 128,
      minGap: 22
    });

    expect(Object.keys(layout)).toHaveLength(nodes.length);
    expect(hasCircularOverlap(nodes, layout, () => 74, 8)).toBe(false);
  });

  it("orders nodes by loop sequence groups", () => {
    const nodes: LoopGraphLayoutNode[] = [
      { id: "metric:1", kind: "metric", label: "Metric", metadata: { semanticLayer: "measurement" } },
      { id: "action:1", kind: "action", label: "Action", metadata: { semanticLayer: "action" } },
      { id: "source:1", kind: "data_source", label: "Data", metadata: { semanticLayer: "data" } },
      { id: "verifier:1", kind: "verification", label: "Check", metadata: { semanticLayer: "verification" } }
    ];

    expect(sortByLoopSequence(nodes).map((node) => node.id)).toEqual([
      "source:1",
      "action:1",
      "verifier:1",
      "metric:1"
    ]);
  });

  it("packs brain clusters without cluster overlap", () => {
    const clusters = [
      { id: "loop:a", radius: 180, rowKey: "marketing", sortKey: "a" },
      { id: "loop:b", radius: 210, rowKey: "marketing", sortKey: "b" },
      { id: "loop:c", radius: 170, rowKey: "sales", sortKey: "c" },
      { id: "loop:d", radius: 240, rowKey: "sales", sortKey: "d" }
    ];
    const packed = packClusterRows(clusters);

    expect(Object.keys(packed.centers)).toHaveLength(clusters.length);
    expect(hasClusterOverlap(clusters, packed.centers, 40)).toBe(false);
    expect(Object.keys(packed.rowCenters).sort()).toEqual(["marketing", "sales"]);
  });

  it("places selected workflow context loops close but outside the internal orbit", () => {
    const internalNodes = Array.from({ length: 12 }).map((_, index): LoopGraphLayoutNode => ({
      id: `step:lead-qualification:${index + 1}`,
      kind: index < 4 ? "data_source" : index < 9 ? "action" : "verification",
      label: `Internal ${index + 1}`,
      metadata: {
        parentId: "loop:lead-qualification",
        semanticLayer: index < 4 ? "data" : index < 9 ? "action" : "verification"
      }
    }));
    const contextLoops: LoopGraphLayoutNode[] = [
      { id: "loop:management", kind: "management", label: "Management", metadata: {} },
      { id: "loop:department:sales", kind: "department", label: "Sales", metadata: { parentId: "loop:management" } }
    ];
    const internalOuterRadius = orbitOuterRadius(internalNodes, () => 74, 150, 22);
    const layout = compactArcLayout({
      center: { x: 0, y: 0 },
      endAngle: -2.18,
      nodes: contextLoops,
      radius: internalOuterRadius + 72,
      sizeForNode: () => 74,
      startAngle: -2.72
    });

    for (const loop of contextLoops) {
      const position = layout[loop.id];
      const distance = Math.hypot(position.x, position.y);
      expect(distance).toBeGreaterThan(internalOuterRadius + 30);
      expect(distance).toBeLessThan(internalOuterRadius + 95);
    }
    expect(hasCircularOverlap(contextLoops, layout, () => 74, 12)).toBe(false);
  });

  it("maps descendants for dragging a loop core with its cluster", () => {
    const nodes: LoopGraphLayoutNode[] = [
      { id: "loop:management", kind: "management", label: "Management", metadata: {} },
      { id: "loop:department:sales", kind: "department", label: "Sales", metadata: { parentId: "loop:management" } },
      { id: "loop:lead-qualification", kind: "loop", label: "Lead Qualification", metadata: { parentId: "loop:department:sales" } },
      { id: "step:lead-qualification:observe", kind: "action", label: "Observe", metadata: { parentId: "loop:lead-qualification" } },
      { id: "verifier:lead-qualification:1", kind: "verification", label: "Verifier", metadata: { parentId: "loop:lead-qualification" } }
    ];
    const descendants = descendantIdsByParentId(nodes);

    expect(descendants.get("loop:lead-qualification")?.sort()).toEqual([
      "step:lead-qualification:observe",
      "verifier:lead-qualification:1"
    ]);
    expect(descendants.get("loop:management")?.sort()).toEqual([
      "loop:department:sales",
      "loop:lead-qualification",
      "step:lead-qualification:observe",
      "verifier:lead-qualification:1"
    ]);
  });
});
