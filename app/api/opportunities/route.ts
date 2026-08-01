import { NextResponse } from "next/server";
import {
  listLoopOpportunities,
  scanLoopOpportunities
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore,
  getLoopOpportunityStore,
  getRoutingStore
} from "../../../lib/loopgraph-runtime/storage-resolver";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const minimumScoreParam = url.searchParams.get("minimumScore");
  const minimumScoreValue = minimumScoreParam === null ? undefined : Number(minimumScoreParam);
  const projectRoot = getActiveLoopgraphProjectRoot();
  const opportunities = await listLoopOpportunities(projectRoot, {
    status: opportunityStatus(url.searchParams.get("status")),
    department: departmentValue(url.searchParams.get("department")),
    minimumScore: minimumScoreValue !== undefined && Number.isFinite(minimumScoreValue)
      ? minimumScoreValue
      : undefined
  }, getLoopOpportunityStore({ projectRoot }));
  return NextResponse.json({ opportunities });
}

export async function POST(request: Request) {
  try {
    const body = await optionalJson(request);
    const qualify = numberValue(body.qualifyThreshold, 45);
    const autoDesign = numberValue(body.autoDesignThreshold, 65);
    const projectRoot = getActiveLoopgraphProjectRoot();
    const result = await scanLoopOpportunities({
      projectRoot,
      workspaceId: stringValue(body.workspaceId),
      companyId: stringValue(body.companyId),
      thresholds: { qualify, autoDesign },
      autoStartDesign: body.autoStartDesign === true
    }, {
      routingStore: getRoutingStore(),
      designStore: getHermesDesignStore(),
      opportunityStore: getLoopOpportunityStore({ projectRoot })
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to scan loop opportunities"
    }, { status: 400 });
  }
}

function opportunityStatus(value: string | null) {
  return value && [
    "detected",
    "qualified",
    "design_requested",
    "designing",
    "proposal_ready",
    "dismissed",
    "implemented"
  ].includes(value)
    ? value as "detected" | "qualified" | "design_requested" | "designing" | "proposal_ready" | "dismissed" | "implemented"
    : undefined;
}

function departmentValue(value: string | null) {
  return value && [
    "management",
    "marketing",
    "sales",
    "product",
    "customer_success",
    "engineering",
    "ops_finance",
    "hr_talent",
    "legal_compliance",
    "custom"
  ].includes(value)
    ? value as "management" | "marketing" | "sales" | "product" | "customer_success" | "engineering" | "ops_finance" | "hr_talent" | "legal_compliance" | "custom"
    : undefined;
}

async function optionalJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
