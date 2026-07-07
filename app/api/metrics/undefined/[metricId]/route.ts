import { NextResponse } from "next/server";
import {
  listUndefinedMetrics,
  saveUndefinedMetric
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ metricId: string }> }
) {
  const { metricId } = await params;
  const body = await request.json();
  const items = await listUndefinedMetrics();
  const item = items.find((metric) => metric.id === metricId);
  if (!item) return NextResponse.json({ error: "Undefined metric not found" }, { status: 404 });
  const next = { ...item, ...body };
  await saveUndefinedMetric(next);
  return NextResponse.json(next);
}

