import { describe, expect, it } from "vitest";
import { createObsidianLayout } from "./use-obsidian-force-layout";
import type { BrainGraphEdge, BrainGraphNode } from "./graph-types";

describe("obsidian force layout", () => {
  it("centers the selected node in local graph mode", () => {
    const nodes = [
      brainNode({ id: "loop:lead-qualification", label: "Lead Qualification Loop" }),
      brainNode({ id: "loop:department:sales", type: "department_loop", label: "Sales Department Loop" }),
      brainNode({ id: "metric:lead", type: "metric", label: "Qualified lead rate" })
    ];
    const layout = createObsidianLayout({
      nodes,
      edges: [
        brainEdge({ source: "loop:department:sales", target: "loop:lead-qualification" }),
        brainEdge({ source: "loop:lead-qualification", target: "metric:lead", type: "loop_updates_metric" })
      ],
      mode: "local",
      centerId: "loop:lead-qualification"
    });
    const center = layout.find((node) => node.id === "loop:lead-qualification");

    expect(center?.x).toBe(0);
    expect(center?.y).toBe(0);
  });

  it("keeps dense circular nodes from overlapping", () => {
    const nodes = [
      brainNode({ id: "company:root", type: "company_brain", radius: 54 }),
      brainNode({ id: "loop:management", type: "management_loop", radius: 46 }),
      ...Array.from({ length: 6 }, (_, index) =>
        brainNode({ id: `loop:department:${index}`, type: "department_loop", radius: 36, label: `Department ${index}` })
      ),
      ...Array.from({ length: 18 }, (_, index) =>
        brainNode({
          id: `loop:workflow:${index}`,
          type: "workflow_loop",
          radius: 30,
          parentId: `loop:department:${index % 6}`,
          label: `Workflow ${index}`
        })
      )
    ];
    const edges = [
      brainEdge({ source: "company:root", target: "loop:management", type: "brain_routes_to" }),
      ...Array.from({ length: 6 }, (_, index) =>
        brainEdge({ source: "loop:management", target: `loop:department:${index}`, type: "management_calls_department" })
      ),
      ...Array.from({ length: 18 }, (_, index) =>
        brainEdge({
          source: `loop:department:${index % 6}`,
          target: `loop:workflow:${index}`,
          type: "department_contains_loop"
        })
      )
    ];
    const layout = createObsidianLayout({ nodes, edges, mode: "global" });
    const overlaps = countOverlaps(layout);

    expect(overlaps).toBe(0);
  });

  it("uses a stable layered hierarchy for direct Hermes Brain design graphs", () => {
    const nodes = [
      brainNode({ id: "company:root", type: "company_brain", label: "Hermes Brain", radius: 54 }),
      brainNode({ id: "loop:department:marketing", type: "department_loop", label: "Marketing", radius: 38, parentId: "company:root" }),
      brainNode({ id: "loop:marketing_ads", type: "workflow_loop", label: "Ads", radius: 32, parentId: "loop:department:marketing" }),
      brainNode({ id: "loop:marketing_content_creation", type: "workflow_loop", label: "Content Creation", radius: 32, parentId: "loop:department:marketing" })
    ];
    const edges = [
      brainEdge({ source: "company:root", target: "loop:department:marketing", type: "brain_routes_to" }),
      brainEdge({ source: "loop:department:marketing", target: "loop:marketing_ads", type: "department_contains_loop" }),
      brainEdge({ source: "loop:department:marketing", target: "loop:marketing_content_creation", type: "department_contains_loop" })
    ];
    const firstLayout = createObsidianLayout({ nodes, edges, mode: "global" });
    const secondLayout = createObsidianLayout({ nodes, edges, mode: "global" });
    const byId = new Map(firstLayout.map((node) => [node.id, node]));
    const brain = byId.get("company:root");
    const marketing = byId.get("loop:department:marketing");
    const ads = byId.get("loop:marketing_ads");
    const content = byId.get("loop:marketing_content_creation");

    expect(secondLayout.map((node) => [node.id, node.x, node.y])).toEqual(
      firstLayout.map((node) => [node.id, node.x, node.y])
    );
    expect(brain?.x).toBeLessThan(marketing?.x ?? 0);
    expect(marketing?.x).toBeLessThan(ads?.x ?? 0);
    expect(marketing?.x).toBeLessThan(content?.x ?? 0);
    expect(ads?.x).toBeCloseTo(content?.x ?? 0, 1);
    expect(countOverlaps(firstLayout)).toBe(0);
  });
});

function countOverlaps(nodes: Array<BrainGraphNode & { x: number; y: number }>) {
  let overlaps = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    for (let next = index + 1; next < nodes.length; next += 1) {
      const left = nodes[index];
      const right = nodes[next];
      const distance = Math.hypot(right.x - left.x, right.y - left.y);
      if (distance < left.radius + right.radius + 2) {
        overlaps += 1;
      }
    }
  }
  return overlaps;
}

function brainNode(overrides: Partial<BrainGraphNode>): BrainGraphNode {
  return {
    id: overrides.id ?? "node",
    type: overrides.type ?? "workflow_loop",
    label: overrides.label ?? "Node",
    parentId: overrides.parentId,
    status: "ready",
    radius: overrides.radius ?? 28,
    color: "#fff",
    stroke: "#111"
  };
}

function brainEdge(overrides: Partial<BrainGraphEdge>): BrainGraphEdge {
  return {
    id: `${overrides.source}->${overrides.target}`,
    source: overrides.source ?? "source",
    target: overrides.target ?? "target",
    type: overrides.type ?? "department_contains_loop",
    semantic: true,
    executable: false,
    width: 1,
    color: "#111",
    opacity: 1
  };
}
