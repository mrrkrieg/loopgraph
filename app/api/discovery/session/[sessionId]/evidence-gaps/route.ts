import { NextResponse } from "next/server";
import {
  getNextEvidenceGapQuestions,
  readEvidenceGapSet,
  resumeHermesDesignTasksForSession,
  submitEvidenceGapAnswer
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getDiscoveryDesignStore,
  getHermesDesignStore,
  getLoopSpecRegistryStore
} from "../../../../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const limitValue = Number(new URL(request.url).searchParams.get("limit") ?? 3);
    const projectRoot = getActiveLoopgraphProjectRoot();
    const store = getDiscoveryDesignStore();
    const next = await getNextEvidenceGapQuestions({
      projectRoot,
      store,
      sessionId,
      limit: Number.isFinite(limitValue) ? limitValue : 3
    });
    return NextResponse.json({
      ...next,
      gapSet: await readEvidenceGapSet(sessionId, projectRoot, store)
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to compile evidence gaps"
    }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const body = await request.json();
    const { sessionId } = await context.params;
    if (!isRecord(body) || typeof body.gapId !== "string") {
      return NextResponse.json({ error: "gapId is required" }, { status: 400 });
    }
    const result = await submitEvidenceGapAnswer({
      projectRoot: getActiveLoopgraphProjectRoot(),
      store: getDiscoveryDesignStore(),
      sessionId,
      gapId: body.gapId,
      answer: body.answer,
      expectedRevision: typeof body.expectedRevision === "number" ? body.expectedRevision : undefined,
      answeredBy: "api",
      evidenceRefs: Array.isArray(body.evidenceRefs)
        ? body.evidenceRefs.filter((item): item is string => typeof item === "string")
        : []
    });
    const resumedTasks = await resumeHermesDesignTasksForSession({
      projectRoot: getActiveLoopgraphProjectRoot(),
      sessionId
    }, {
      store: getHermesDesignStore(),
      discoveryStore: getDiscoveryDesignStore(),
      loopSpecStore: getLoopSpecRegistryStore()
    });
    return NextResponse.json({ ...result, resumedTasks }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to answer evidence gap"
    }, { status: 400 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
