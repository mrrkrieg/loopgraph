import path from "node:path";
import { NextResponse } from "next/server";
import { loadEventRoutingOperations, routingOperationsQueryFromUrl } from "loopgraph/runtime";

export async function GET(request: Request) {
  try {
    const query = routingOperationsQueryFromUrl(new URL(request.url));
    const model = await loadEventRoutingOperations({
      projectRoot: getBrowserProjectRoot(),
      ...query
    });

    return NextResponse.json({
      ok: true,
      model
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load Hermes routing operations"
    }, { status: 400 });
  }
}

function getBrowserProjectRoot(): string {
  return path.resolve(process.env.LOOPGRAPH_PROJECT_ROOT ?? process.cwd());
}
