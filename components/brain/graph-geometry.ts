import type { BrainGraphNode } from "./graph-types";

export function getEdgeEndpoints(input: {
  source: BrainGraphNode;
  target: BrainGraphNode;
}): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} | null {
  const sx = input.source.x;
  const sy = input.source.y;
  const tx = input.target.x;
  const ty = input.target.y;

  if (!isFiniteNumber(sx) || !isFiniteNumber(sy) || !isFiniteNumber(tx) || !isFiniteNumber(ty)) {
    return null;
  }

  const dx = tx - sx;
  const dy = ty - sy;
  const distance = Math.hypot(dx, dy);

  if (!isFiniteNumber(distance) || distance <= 0.001) {
    return null;
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const sourceRadius = Math.max(input.source.radius ?? 0, 0);
  const targetRadius = Math.max(input.target.radius ?? 0, 0);

  return {
    x1: sx + ux * sourceRadius,
    y1: sy + uy * sourceRadius,
    x2: tx - ux * targetRadius,
    y2: ty - uy * targetRadius
  };
}

export function curvedEdgePath(input: {
  source: BrainGraphNode;
  target: BrainGraphNode;
  curve?: number;
}) {
  const endpoints = getEdgeEndpoints(input);
  if (!endpoints) {
    return null;
  }

  const mx = (endpoints.x1 + endpoints.x2) / 2;
  const my = (endpoints.y1 + endpoints.y2) / 2;
  const dx = endpoints.x2 - endpoints.x1;
  const dy = endpoints.y2 - endpoints.y1;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const bend = input.curve ?? 0.16;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const qx = mx + normalX * distance * bend;
  const qy = my + normalY * distance * bend;

  return `M ${round(endpoints.x1)} ${round(endpoints.y1)} Q ${round(qx)} ${round(qy)} ${round(endpoints.x2)} ${round(endpoints.y2)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
