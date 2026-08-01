import { NextResponse } from "next/server";
import {
  callLoopgraphOutcomeTool,
  metricSampleIngestInputSchema,
  metricSamplesGetInputSchema
} from "loopgraph/runtime";
import { isHostedPreview } from "../../../../lib/hosted-preview";
import { getActiveLoopgraphProjectRoot, getOutcomeStore } from "../../../../lib/loopgraph-runtime/storage-resolver";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = metricSamplesGetInputSchema.parse({
      sampleId: optionalParam(url, "sampleId"),
      companyId: optionalParam(url, "companyId"),
      departmentId: optionalParam(url, "departmentId"),
      loopId: optionalParam(url, "loopId"),
      metricDefinitionId: optionalParam(url, "metricDefinitionId"),
      metricKey: optionalParam(url, "metricKey"),
      windowStart: optionalParam(url, "windowStart"),
      windowEnd: optionalParam(url, "windowEnd")
    });
    const projectRoot = getActiveLoopgraphProjectRoot();
    const result = await callLoopgraphOutcomeTool("loopgraph_metric_samples_get", input, { projectRoot, store: getOutcomeStore({ projectRoot }) });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (isHostedPreview()) {
    return NextResponse.json({
      error: "The hosted preview is read-only. Record metric evidence in a project-bound local workspace."
    }, { status: 403 });
  }
  try {
    const input = metricSampleIngestInputSchema.parse(await request.json());
    const projectRoot = getActiveLoopgraphProjectRoot();
    const result = await callLoopgraphOutcomeTool("loopgraph_metric_samples_ingest", input, { projectRoot, store: getOutcomeStore({ projectRoot }) });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function optionalParam(url: URL, key: string) {
  return url.searchParams.get(key) ?? undefined;
}

function errorResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Metric evidence request failed"
  }, { status: 400 });
}
