import { NextResponse } from "next/server";
import {
  generateMetricPlan,
  loadDiscoverySession,
  saveDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = await loadDiscoverySession(sessionId);
  if (!session) return NextResponse.json({ error: "Discovery session not found" }, { status: 404 });
  const metricPlan = await generateMetricPlan(session.recommendedLoops, session.accessRequirements);
  const next = {
    ...session,
    metricDefinitions: metricPlan.metricDefinitions,
    undefinedMetrics: metricPlan.undefinedMetrics,
    status: "metric_definition" as const,
    updatedAt: new Date().toISOString()
  };
  await saveDiscoverySession(next);
  return NextResponse.json(next);
}

