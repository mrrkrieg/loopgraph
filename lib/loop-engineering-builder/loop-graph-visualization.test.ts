import { describe, expect, it } from "vitest";
import { buildTemplateLoopGraph } from "./loop-graph-visualization";
import { getTemplateCatalog } from "./templates";

describe("loop graph visualization builder", () => {
  it("creates a complete visual graph for every template", () => {
    for (const template of getTemplateCatalog()) {
      const graph = buildTemplateLoopGraph(template);
      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      const kinds = new Set(graph.nodes.map((node) => node.kind));

      expect(nodeIds.has(`template:${template.id}:loop`)).toBe(true);
      expect(kinds.has("data_source")).toBe(true);
      expect(kinds.has("action")).toBe(true);
      expect(kinds.has("verification")).toBe(true);
      expect(kinds.has("owner")).toBe(true);
      expect(kinds.has("review")).toBe(true);
      expect(kinds.has("metric")).toBe(true);
      expect(graph.edges.length).toBeGreaterThanOrEqual(6);

      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    }
  });
});
