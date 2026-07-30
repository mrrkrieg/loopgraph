import { NextResponse } from "next/server";
import {
  callLoopgraphOutcomeTool,
  outcomesEvaluateInputSchema,
  outcomesGetInputSchema
} from "loopgraph/runtime";
import { isHostedPreview } from "../../../../lib/hosted-preview";
import { getActiveLoopgraphProjectRoot } from "../../../../lib/loopgraph-runtime/storage-resolver";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = outcomesGetInputSchema.parse({
      outcomeId: optionalParam(url, "outcomeId"),
      companyId: optionalParam(url, "companyId"),
      departmentId: optionalParam(url, "departmentId"),
      loopId: optionalParam(url, "loopId"),
      metricDefinitionId: optionalParam(url, "metricDefinitionId"),
      status: optionalParam(url, "status")
    });
    const result = await callLoopgraphOutcomeTool("loopgraph_outcomes_get", input, {
      projectRoot: getActiveLoopgraphProjectRoot()
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (isHostedPreview()) {
    return NextResponse.json({
      error: "The hosted preview is read-only. Evaluate outcomes in a project-bound local workspace."
    }, { status: 403 });
  }
  try {
    const input = outcomesEvaluateInputSchema.parse(await request.json());
    const result = await callLoopgraphOutcomeTool("loopgraph_outcomes_evaluate", input, {
      projectRoot: getActiveLoopgraphProjectRoot()
    });
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
    error: error instanceof Error ? error.message : "Observed outcome request failed"
  }, { status: 400 });
}
