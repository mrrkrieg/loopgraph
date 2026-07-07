import type {
  LoopGraphVisualNode,
  LoopGraphVisualNodeKind
} from "./loop-graph-visualization";

export type LoopGraphLayoutPosition = {
  x: number;
  y: number;
};

export type LoopGraphLayoutNode = Pick<LoopGraphVisualNode, "id" | "kind" | "label" | "metadata">;

export type LoopGraphLayoutCluster = {
  id: string;
  radius: number;
  rowKey: string;
  sortKey?: string;
};

export type PackedClusterRows = {
  centers: Record<string, LoopGraphLayoutPosition>;
  rowCenters: Record<string, number>;
};

type PackedOrbitInput<TNode extends LoopGraphLayoutNode> = {
  center: LoopGraphLayoutPosition;
  nodes: TNode[];
  sizeForNode: (node: TNode) => number;
  centerSize?: number;
  minGap?: number;
  startAngle?: number;
};

type CompactArcInput<TNode extends LoopGraphLayoutNode> = {
  center: LoopGraphLayoutPosition;
  nodes: TNode[];
  radius: number;
  startAngle: number;
  endAngle: number;
  sizeForNode?: (node: TNode) => number;
  minGap?: number;
};

const sequenceGroupOrder: Record<string, number> = {
  trigger: 0,
  structure: 8,
  data: 10,
  memory: 12,
  action: 20,
  verification: 30,
  human: 40,
  measurement: 50,
  runtime: 60,
  improvement: 70
};

const kindSequenceOrder: Record<LoopGraphVisualNodeKind, number> = {
  trigger: 0,
  organization: 2,
  management: 4,
  department: 6,
  loop: 8,
  data_source: 10,
  action: 20,
  verification: 30,
  owner: 40,
  review: 42,
  metric: 50,
  rollup: 52,
  improvement: 70
};

export function sequenceGroupForVisualNode(node: LoopGraphLayoutNode) {
  const layer = typeof node.metadata?.semanticLayer === "string"
    ? node.metadata.semanticLayer
    : undefined;
  if (node.kind === "trigger") {
    return "trigger";
  }
  if (layer) {
    return layer;
  }
  if (node.kind === "data_source") {
    return "data";
  }
  if (node.kind === "action") {
    return "action";
  }
  if (node.kind === "verification") {
    return "verification";
  }
  if (node.kind === "owner" || node.kind === "review") {
    return "human";
  }
  if (node.kind === "metric" || node.kind === "rollup") {
    return "measurement";
  }
  if (node.kind === "improvement") {
    return "improvement";
  }
  return "structure";
}

export function sequenceIndexForVisualNode(node: LoopGraphLayoutNode) {
  const explicitIndex = node.metadata?.sequenceIndex;
  if (typeof explicitIndex === "number" && Number.isFinite(explicitIndex)) {
    return explicitIndex;
  }

  const group = sequenceGroupForVisualNode(node);
  const groupRank = sequenceGroupOrder[group] ?? kindSequenceOrder[node.kind] ?? 99;
  const localRank = stableNodeRank(node.id);
  return groupRank * 1000 + localRank;
}

export function sortByLoopSequence<TNode extends LoopGraphLayoutNode>(nodes: TNode[]) {
  return [...nodes].sort((left, right) => {
    const sequenceDelta = sequenceIndexForVisualNode(left) - sequenceIndexForVisualNode(right);
    if (sequenceDelta !== 0) {
      return sequenceDelta;
    }
    return `${left.label}:${left.id}`.localeCompare(`${right.label}:${right.id}`);
  });
}

export function packedOrbitLayout<TNode extends LoopGraphLayoutNode>({
  center,
  nodes,
  sizeForNode,
  centerSize = 118,
  minGap = 18,
  startAngle = -Math.PI / 2
}: PackedOrbitInput<TNode>) {
  const sortedNodes = sortByLoopSequence(nodes);
  const layout: Record<string, LoopGraphLayoutPosition> = {};
  if (sortedNodes.length === 0) {
    return layout;
  }

  const maxNodeSize = Math.max(...sortedNodes.map(sizeForNode), 1);
  const baseRadius = Math.max(centerSize / 2 + maxNodeSize / 2 + minGap * 1.7, 128);
  const ringGap = maxNodeSize + minGap * 2.2;
  let cursor = 0;
  let ring = 0;

  while (cursor < sortedNodes.length) {
    const radius = baseRadius + ring * ringGap;
    const capacity = Math.max(
      1,
      Math.floor((Math.PI * 2 * radius) / Math.max(maxNodeSize + minGap, 1))
    );
    const remaining = sortedNodes.length - cursor;
    const ringNodes = sortedNodes.slice(cursor, cursor + Math.min(capacity, remaining));
    const ringStartAngle = startAngle + ring * 0.38;

    ringNodes.forEach((node, index) => {
      const angle = ringStartAngle + (Math.PI * 2 * index) / Math.max(ringNodes.length, 1);
      layout[node.id] = {
        x: roundCoord(center.x + Math.cos(angle) * radius),
        y: roundCoord(center.y + Math.sin(angle) * radius)
      };
    });

    cursor += ringNodes.length;
    ring += 1;
  }

  return resolveCircularCollisions(sortedNodes, layout, sizeForNode, minGap);
}

export function orbitOuterRadius<TNode extends LoopGraphLayoutNode>(
  nodes: TNode[],
  sizeForNode: (node: TNode) => number,
  centerSize = 118,
  minGap = 18
) {
  if (nodes.length === 0) {
    return centerSize / 2;
  }
  const layout = packedOrbitLayout({
    center: { x: 0, y: 0 },
    nodes,
    sizeForNode,
    centerSize,
    minGap
  });
  return Math.max(
    centerSize / 2,
    ...nodes.map((node) => {
      const position = layout[node.id];
      if (!position) {
        return centerSize / 2;
      }
      return Math.hypot(position.x, position.y) + sizeForNode(node) / 2;
    })
  );
}

export function compactArcLayout<TNode extends LoopGraphLayoutNode>({
  center,
  endAngle,
  minGap = 18,
  nodes,
  radius,
  sizeForNode,
  startAngle
}: CompactArcInput<TNode>) {
  const layout: Record<string, LoopGraphLayoutPosition> = {};
  if (nodes.length === 0) {
    return layout;
  }

  const span = endAngle - startAngle;
  nodes.forEach((node, index) => {
    const angle = nodes.length === 1
      ? startAngle + span / 2
      : startAngle + (span * index) / Math.max(nodes.length - 1, 1);
    layout[node.id] = {
      x: roundCoord(center.x + Math.cos(angle) * radius),
      y: roundCoord(center.y + Math.sin(angle) * radius)
    };
  });

  return sizeForNode ? resolveCircularCollisions(nodes, layout, sizeForNode, minGap) : layout;
}

export function hasCircularOverlap<TNode extends LoopGraphLayoutNode>(
  nodes: TNode[],
  layout: Record<string, LoopGraphLayoutPosition>,
  sizeForNode: (node: TNode) => number,
  minGap = 0
) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const leftPosition = layout[left.id];
      const rightPosition = layout[right.id];
      if (!leftPosition || !rightPosition) {
        continue;
      }
      const requiredDistance = sizeForNode(left) / 2 + sizeForNode(right) / 2 + minGap;
      const actualDistance = Math.hypot(
        leftPosition.x - rightPosition.x,
        leftPosition.y - rightPosition.y
      );
      if (actualDistance + 0.001 < requiredDistance) {
        return true;
      }
    }
  }
  return false;
}

export function descendantIdsByParentId<TNode extends { id: string; metadata?: Record<string, unknown> }>(
  nodes: TNode[]
) {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parentId = typeof node.metadata?.parentId === "string" ? node.metadata.parentId : undefined;
    if (!parentId) {
      continue;
    }
    children.set(parentId, [...(children.get(parentId) ?? []), node.id]);
  }

  const descendants = new Map<string, string[]>();
  for (const node of nodes) {
    const collected: string[] = [];
    const queue = [...(children.get(node.id) ?? [])];
    while (queue.length > 0) {
      const childId = queue.shift();
      if (!childId || collected.includes(childId)) {
        continue;
      }
      collected.push(childId);
      queue.push(...(children.get(childId) ?? []));
    }
    descendants.set(node.id, collected);
  }
  return descendants;
}

export function packClusterRows(
  clusters: LoopGraphLayoutCluster[],
  options: {
    columnGap?: number;
    minRowHeight?: number;
    rowGap?: number;
  } = {}
): PackedClusterRows {
  const columnGap = options.columnGap ?? 160;
  const minRowHeight = options.minRowHeight ?? 300;
  const rowGap = options.rowGap ?? 120;
  const byRow = new Map<string, LoopGraphLayoutCluster[]>();

  for (const cluster of clusters) {
    byRow.set(cluster.rowKey, [...(byRow.get(cluster.rowKey) ?? []), cluster]);
  }

  const rows = Array.from(byRow.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rowKey, rowClusters]) => ({
      rowKey,
      clusters: [...rowClusters].sort((left, right) =>
        `${left.sortKey ?? left.id}:${left.id}`.localeCompare(`${right.sortKey ?? right.id}:${right.id}`)
      )
    }));

  let cursorY = 0;
  const rowLayout = rows.map((row) => {
    const rowHeight = Math.max(
      minRowHeight,
      ...row.clusters.map((cluster) => cluster.radius * 2 + rowGap * 0.75)
    );
    const centerY = cursorY + rowHeight / 2;
    cursorY += rowHeight + rowGap;
    return { ...row, centerY, rowHeight };
  });
  const offsetY = cursorY > 0 ? (cursorY - rowGap) / 2 : 0;
  const centers: Record<string, LoopGraphLayoutPosition> = {};
  const rowCenters: Record<string, number> = {};

  for (const row of rowLayout) {
    const y = roundCoord(row.centerY - offsetY);
    rowCenters[row.rowKey] = y;
    let cursorX = 0;
    for (const cluster of row.clusters) {
      centers[cluster.id] = {
        x: roundCoord(cursorX + cluster.radius),
        y
      };
      cursorX += cluster.radius * 2 + columnGap;
    }
  }

  return { centers, rowCenters };
}

export function hasClusterOverlap(
  clusters: LoopGraphLayoutCluster[],
  centers: Record<string, LoopGraphLayoutPosition>,
  minGap = 0
) {
  for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
      const left = clusters[leftIndex];
      const right = clusters[rightIndex];
      const leftCenter = centers[left.id];
      const rightCenter = centers[right.id];
      if (!leftCenter || !rightCenter) {
        continue;
      }
      const requiredDistance = left.radius + right.radius + minGap;
      const actualDistance = Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
      if (actualDistance + 0.001 < requiredDistance) {
        return true;
      }
    }
  }
  return false;
}

function resolveCircularCollisions<TNode extends LoopGraphLayoutNode>(
  nodes: TNode[],
  layout: Record<string, LoopGraphLayoutPosition>,
  sizeForNode: (node: TNode) => number,
  minGap: number
) {
  const next = { ...layout };
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const leftPosition = next[left.id];
        const rightPosition = next[right.id];
        if (!leftPosition || !rightPosition) {
          continue;
        }

        const dx = rightPosition.x - leftPosition.x;
        const dy = rightPosition.y - leftPosition.y;
        const distance = Math.max(Math.hypot(dx, dy), 0.001);
        const requiredDistance = sizeForNode(left) / 2 + sizeForNode(right) / 2 + minGap;
        const overlap = requiredDistance - distance;
        if (overlap <= 0) {
          continue;
        }

        const push = overlap / 2 + 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        next[left.id] = {
          x: roundCoord(leftPosition.x - nx * push),
          y: roundCoord(leftPosition.y - ny * push)
        };
        next[right.id] = {
          x: roundCoord(rightPosition.x + nx * push),
          y: roundCoord(rightPosition.y + ny * push)
        };
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }
  return next;
}

function stableNodeRank(value: string) {
  const numericParts = value.match(/\d+/g);
  if (numericParts?.length) {
    return Number(numericParts[numericParts.length - 1]);
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 997;
}

function roundCoord(value: number) {
  return Math.round(value * 1000) / 1000;
}
