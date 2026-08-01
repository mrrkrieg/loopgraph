"use client";

import { useCallback, useMemo, useState } from "react";
import type { BrainGraphEdge, BrainGraphMode, BrainGraphNode } from "./graph-types";

export type PositionedBrainNode = BrainGraphNode & {
  x: number;
  y: number;
};

export type LayoutInput = {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  mode: BrainGraphMode;
  centerId?: string;
};

export type LayoutBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export function useObsidianForceLayout(input: LayoutInput, initialPositions: Record<string, { x: number; y: number }> = {}) {
  const [positionOverrides, setPositionOverrides] = useState<Record<string, { x: number; y: number }>>(initialPositions);
  const { centerId, edges, mode, nodes: inputNodes } = input;
  const baseNodes = useMemo(
    () => createObsidianLayout({ centerId, edges, mode, nodes: inputNodes }),
    [centerId, edges, inputNodes, mode]
  );
  const nodes = useMemo(
    () =>
      baseNodes.map((node) => {
        const override = positionOverrides[node.id];
        return override ? { ...node, x: override.x, y: override.y, fx: override.x, fy: override.y } : node;
      }),
    [baseNodes, positionOverrides]
  );
  const setNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    setPositionOverrides((current) => ({
      ...current,
      [nodeId]: { x, y }
    }));
  }, []);
  const resetLayout = useCallback(() => {
    setPositionOverrides({});
  }, []);

  return {
    nodes,
    setNodePosition,
    resetLayout
  };
}

export function createObsidianLayout(input: LayoutInput): PositionedBrainNode[] {
  const nodes = input.nodes.map((node) => ({ ...node, x: 0, y: 0 }));

  if (input.mode === "local" && input.centerId) {
    seedLocalLayout(nodes, input.edges, input.centerId);
  } else {
    seedGlobalLayout(nodes, input.edges);
  }

  relaxCollisions(nodes, input.edges);
  return nodes.map((node) => ({
    ...node,
    x: round(node.x),
    y: round(node.y)
  }));
}

export function getLayoutBounds(nodes: Array<Pick<BrainGraphNode, "x" | "y" | "radius">>): LayoutBounds {
  if (nodes.length === 0) {
    return { minX: -100, minY: -100, maxX: 100, maxY: 100, width: 200, height: 200 };
  }
  const minX = Math.min(...nodes.map((node) => (node.x ?? 0) - node.radius));
  const maxX = Math.max(...nodes.map((node) => (node.x ?? 0) + node.radius));
  const minY = Math.min(...nodes.map((node) => (node.y ?? 0) - node.radius));
  const maxY = Math.max(...nodes.map((node) => (node.y ?? 0) + node.radius));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  };
}

function seedGlobalLayout(nodes: PositionedBrainNode[], edges: BrainGraphEdge[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const company = nodes.find((node) => node.type === "company_brain");
  const management = nodes.find((node) => node.type === "management_loop");
  const departments = nodes.filter((node) => node.type === "department_loop").sort(byLabel);
  const workflowsByDepartment = new Map<string, PositionedBrainNode[]>();
  const internalByLoop = new Map<string, PositionedBrainNode[]>();
  const previewIncomingNodes: PositionedBrainNode[] = [];
  const previewEvidenceNodes: PositionedBrainNode[] = [];

  for (const node of nodes) {
    if (previewRole(node) === "incoming_signal") {
      previewIncomingNodes.push(node);
      continue;
    }
    if (previewRole(node) === "evidence_outcome") {
      previewEvidenceNodes.push(node);
      continue;
    }
    if (node.type === "workflow_loop") {
      const parentId = node.parentId ?? parentFromEdges(node.id, edges);
      const bucket = workflowsByDepartment.get(parentId ?? "unassigned") ?? [];
      bucket.push(node);
      workflowsByDepartment.set(parentId ?? "unassigned", bucket);
    }
    if (["data", "metric", "review", "improvement", "trace"].includes(node.type)) {
      const parentId = node.parentId ?? (node.loopId ? `loop:${node.loopId}` : undefined);
      const bucket = internalByLoop.get(parentId ?? "unassigned") ?? [];
      bucket.push(node);
      internalByLoop.set(parentId ?? "unassigned", bucket);
    }
  }

  if (company && !management && departments.length > 0) {
    seedDirectHermesHierarchy({
      company,
      departments,
      workflowsByDepartment,
      internalByLoop,
      nodes,
      nodesById,
      previewIncomingNodes,
      previewEvidenceNodes
    });
    return;
  }

  if (company) {
    company.x = -360;
    company.y = 0;
  }
  if (management) {
    management.x = -90;
    management.y = 0;
  }
  if (company) {
    seedPreviewStoryColumns({
      company,
      incomingNodes: previewIncomingNodes,
      evidenceNodes: previewEvidenceNodes
    });
  }

  const departmentRadius = Math.max(260, departments.length * 42);
  const startAngle = -Math.PI * 0.65;
  const endAngle = Math.PI * 0.65;
  departments.forEach((department, index) => {
    const fraction = departments.length === 1 ? 0.5 : index / (departments.length - 1);
    const angle = startAngle + (endAngle - startAngle) * fraction;
    department.x = 180 + Math.cos(angle) * departmentRadius;
    department.y = Math.sin(angle) * departmentRadius * 0.82;

    const workflows = (workflowsByDepartment.get(department.id) ?? []).sort(byLabel);
    seedRing(workflows, {
      centerX: department.x,
      centerY: department.y,
      radius: ringRadius(workflows, 78),
      startAngle: angle - Math.PI / 2
    });
  });

  const unassigned = workflowsByDepartment.get("unassigned") ?? [];
  seedRing(unassigned, { centerX: 260, centerY: 0, radius: ringRadius(unassigned, 92) });

  for (const [loopId, internals] of internalByLoop) {
    const parent = nodesById.get(loopId);
    if (!parent) {
      seedRing(internals, { centerX: 0, centerY: 0, radius: ringRadius(internals, 60) });
      continue;
    }
    seedRing(internals.sort(byLayerThenLabel), {
      centerX: parent.x,
      centerY: parent.y,
      radius: ringRadius(internals, 58),
      startAngle: -Math.PI * 0.72
    });
  }

  for (const node of nodes) {
    if (node.x === 0 && node.y === 0 && node.type !== "management_loop") {
      const point = seededPoint(node.id, 520);
      node.x = point.x;
      node.y = point.y;
    }
  }
}

function seedDirectHermesHierarchy(input: {
  company: PositionedBrainNode;
  departments: PositionedBrainNode[];
  workflowsByDepartment: Map<string, PositionedBrainNode[]>;
  internalByLoop: Map<string, PositionedBrainNode[]>;
  nodes: PositionedBrainNode[];
  nodesById: Map<string, PositionedBrainNode>;
  previewIncomingNodes: PositionedBrainNode[];
  previewEvidenceNodes: PositionedBrainNode[];
}) {
  input.company.x = -360;
  input.company.y = 0;
  seedPreviewStoryColumns({
    company: input.company,
    incomingNodes: input.previewIncomingNodes,
    evidenceNodes: input.previewEvidenceNodes
  });

  const departmentGap = Math.max(190, Math.min(280, 640 / Math.max(input.departments.length, 1)));
  const departmentStartY = -((input.departments.length - 1) * departmentGap) / 2;
  input.departments.forEach((department, index) => {
    department.x = -80;
    department.y = departmentStartY + index * departmentGap;

    const workflows = (input.workflowsByDepartment.get(department.id) ?? []).sort(byLabel);
    seedWorkflowLayer(workflows, {
      x: 240,
      centerY: department.y,
      rowGap: 112,
      columnGap: 210,
      maxRowsPerColumn: 4
    });
  });

  const unassigned = (input.workflowsByDepartment.get("unassigned") ?? []).sort(byLabel);
  seedWorkflowLayer(unassigned, {
    x: 240,
    centerY: departmentStartY + input.departments.length * departmentGap,
    rowGap: 112,
    columnGap: 210,
    maxRowsPerColumn: 4
  });

  for (const [loopId, internals] of input.internalByLoop) {
    const parent = input.nodesById.get(loopId);
    if (!parent) {
      seedRing(internals, { centerX: 0, centerY: 0, radius: ringRadius(internals, 60) });
      continue;
    }
    seedRing(internals.sort(byLayerThenLabel), {
      centerX: parent.x,
      centerY: parent.y,
      radius: ringRadius(internals, 58),
      startAngle: -Math.PI * 0.72
    });
  }

  for (const node of input.nodes) {
    if (node.x === 0 && node.y === 0 && node.id !== input.company.id) {
      const point = seededPoint(node.id, 520);
      node.x = point.x;
      node.y = point.y;
    }
  }
}

function seedWorkflowLayer(
  nodes: PositionedBrainNode[],
  options: {
    x: number;
    centerY: number;
    rowGap: number;
    columnGap: number;
    maxRowsPerColumn: number;
  }
) {
  if (nodes.length === 0) return;
  nodes.forEach((node, index) => {
    const column = Math.floor(index / options.maxRowsPerColumn);
    const row = index % options.maxRowsPerColumn;
    const rowsInColumn = Math.min(
      options.maxRowsPerColumn,
      nodes.length - column * options.maxRowsPerColumn
    );
    node.x = options.x + column * options.columnGap;
    node.y = options.centerY + (row - (rowsInColumn - 1) / 2) * options.rowGap;
  });
}

function seedLocalLayout(nodes: PositionedBrainNode[], edges: BrainGraphEdge[], centerId: string) {
  const center = nodes.find((node) => node.id === centerId) ?? nodes[0];
  if (!center) {
    return;
  }
  const distances = distanceMap(center.id, edges);
  const rings = new Map<number, PositionedBrainNode[]>();

  center.x = 0;
  center.y = 0;

  for (const node of nodes) {
    if (node.id === center.id) {
      continue;
    }
    const distance = distances.get(node.id) ?? 3;
    const bucket = rings.get(distance) ?? [];
    bucket.push(node);
    rings.set(distance, bucket);
  }

  for (const [distance, ringNodes] of Array.from(rings.entries()).sort(([left], [right]) => left - right)) {
    const radius = Math.max(140 * distance, ringRadius(ringNodes, distance === 1 ? 92 : 74));
    seedRing(ringNodes.sort(bySemanticOrder), {
      centerX: 0,
      centerY: 0,
      radius,
      startAngle: -Math.PI / 2
    });
  }
}

function relaxCollisions(nodes: PositionedBrainNode[], edges: BrainGraphEdge[]) {
  const linkTargets = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = linkTargets.get(edge.source) ?? [];
    targets.push(edge.target);
    linkTargets.set(edge.source, targets);
  }

  for (let iteration = 0; iteration < 80; iteration += 1) {
    for (let index = 0; index < nodes.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
        const left = nodes[index];
        const right = nodes[nextIndex];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.max(Math.hypot(dx, dy), 0.001);
        const minDistance = left.radius + right.radius + collisionPadding(left, right);

        if (distance >= minDistance) {
          continue;
        }

        const push = (minDistance - distance) / 2;
        const ux = dx / distance || seededDirection(left.id, right.id).x;
        const uy = dy / distance || seededDirection(left.id, right.id).y;
        left.x -= ux * push;
        left.y -= uy * push;
        right.x += ux * push;
        right.y += uy * push;
      }
    }
  }

  for (const [sourceId, targetIds] of linkTargets) {
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) {
      continue;
    }
    for (const targetId of targetIds) {
      const target = nodes.find((node) => node.id === targetId);
      if (
        !target ||
        target.type === "company_brain" ||
        target.type === "department_loop" ||
        target.type === "management_loop"
      ) {
        continue;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const maxDistance = target.type === "workflow_loop" ? 210 : 140;
      if (distance <= maxDistance) {
        continue;
      }
      const pull = (distance - maxDistance) * 0.18;
      target.x -= (dx / distance) * pull;
      target.y -= (dy / distance) * pull;
    }
  }
}

function seedRing(
  nodes: PositionedBrainNode[],
  options: { centerX: number; centerY: number; radius: number; startAngle?: number }
) {
  const ringCount = Math.max(nodes.length, 1);
  nodes.forEach((node, index) => {
    const angle = (options.startAngle ?? 0) + (Math.PI * 2 * index) / ringCount;
    node.x = options.centerX + Math.cos(angle) * options.radius;
    node.y = options.centerY + Math.sin(angle) * options.radius;
  });
}

function seedPreviewStoryColumns(input: {
  company: PositionedBrainNode;
  incomingNodes: PositionedBrainNode[];
  evidenceNodes: PositionedBrainNode[];
}) {
  seedVerticalStack(input.incomingNodes.sort(byPreviewOrder), {
    x: input.company.x - 330,
    centerY: input.company.y,
    rowGap: 76
  });
  seedVerticalStack(input.evidenceNodes.sort(byPreviewOrder), {
    x: input.company.x + 1020,
    centerY: input.company.y,
    rowGap: 82
  });
}

function seedVerticalStack(
  nodes: PositionedBrainNode[],
  options: { x: number; centerY: number; rowGap: number }
) {
  if (nodes.length === 0) {
    return;
  }

  const startY = options.centerY - ((nodes.length - 1) * options.rowGap) / 2;
  nodes.forEach((node, index) => {
    node.x = options.x;
    node.y = startY + index * options.rowGap;
  });
}

function ringRadius(nodes: BrainGraphNode[], minimum: number) {
  if (nodes.length <= 1) {
    return minimum;
  }
  const averageDiameter = nodes.reduce((sum, node) => sum + node.radius * 2, 0) / nodes.length;
  const circumference = nodes.length * (averageDiameter + 26);
  return Math.max(minimum, circumference / (Math.PI * 2));
}

function distanceMap(centerId: string, edges: BrainGraphEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    addNeighbor(adjacency, edge.source, edge.target);
    addNeighbor(adjacency, edge.target, edge.source);
  }
  const distances = new Map<string, number>([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const distance = distances.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      if (!distances.has(next)) {
        distances.set(next, distance + 1);
        queue.push(next);
      }
    }
  }
  return distances;
}

function addNeighbor(map: Map<string, Set<string>>, source: string, target: string) {
  const neighbors = map.get(source) ?? new Set<string>();
  neighbors.add(target);
  map.set(source, neighbors);
}

function parentFromEdges(nodeId: string, edges: BrainGraphEdge[]) {
  return edges.find((edge) => edge.target === nodeId)?.source;
}

function previewRole(node: BrainGraphNode) {
  return typeof node.metadata?.previewRole === "string" ? node.metadata.previewRole : undefined;
}

function byPreviewOrder(left: BrainGraphNode, right: BrainGraphNode) {
  return previewOrder(left) - previewOrder(right) || left.label.localeCompare(right.label);
}

function previewOrder(node: BrainGraphNode) {
  return typeof node.metadata?.previewOrder === "number" ? node.metadata.previewOrder : 999;
}

function collisionPadding(left: BrainGraphNode, right: BrainGraphNode) {
  if (left.type === "workflow_loop" || right.type === "workflow_loop") {
    return 28;
  }
  if (left.type === "company_brain" || right.type === "company_brain") {
    return 38;
  }
  return 18;
}

function seededPoint(id: string, radius: number) {
  const angle = hash(id) * Math.PI * 2;
  const distance = radius * (0.62 + hash(`${id}:distance`) * 0.38);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance
  };
}

function seededDirection(left: string, right: string) {
  const angle = hash(`${left}:${right}`) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0) / 4294967295;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function byLabel(left: BrainGraphNode, right: BrainGraphNode) {
  return left.label.localeCompare(right.label);
}

function byLayerThenLabel(left: BrainGraphNode, right: BrainGraphNode) {
  return `${semanticRank(left)}:${left.label}`.localeCompare(`${semanticRank(right)}:${right.label}`);
}

function bySemanticOrder(left: BrainGraphNode, right: BrainGraphNode) {
  return semanticRank(left) - semanticRank(right) || left.label.localeCompare(right.label);
}

function semanticRank(node: BrainGraphNode) {
  if (node.type === "data") return 0;
  if (node.type === "workflow_loop") return 1;
  if (node.type === "review") return 2;
  if (node.type === "metric") return 3;
  if (node.type === "improvement") return 4;
  if (node.type === "trace") return 5;
  if (node.type === "department_loop") return 6;
  if (node.type === "management_loop") return 7;
  return 8;
}
