import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  activateHermesRoutes,
  AmbientWorkloadTokenProvider,
  getHermesRouteActivationStatus,
  HermesRouteActivationError,
  prepareHermesRouteActivation,
  ProjectedFileWorkloadTokenProvider,
  type HermesRouteActivationStatus,
  type WorkloadTokenProvider
} from "loopgraph/runtime";
import { safeConnectorError } from "@/lib/connector-broker/safe-error";
import { createHostedHermesRouteActivationAuthorityProvider } from "@/lib/loopgraph-runtime/hosted-hermes-route-authority";
import {
  getActiveLoopgraphProjectRoot,
  getHermesRouteActivationStore
} from "@/lib/loopgraph-runtime/storage-resolver";
import { authorizeBearerApiRequest } from "@/lib/loopgraph-runtime/worker-api-auth";

export const runtime = "nodejs";

const MAX_ACTIVATION_BODY_BYTES = 8 * 1024;
const activationRequestSchema = z.object({
  schemaVersion: z.literal("hosted-hermes-route-activation-request/v1alpha1"),
  confirmationDigest: z.string().regex(/^[a-f0-9]{16}$/)
}).strict();

/**
 * Returns either the current secret-free plan or the current distributed
 * receipt status. Tenant, project, workspace, and filesystem scope are
 * derived exclusively from the server-side hosted binding.
 */
export async function GET(request: Request) {
  const unauthorized = await authorizeRouteActivationRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const context = activationContext();
    const view = new URL(request.url).searchParams.get("view") ?? "status";
    if (view === "plan") {
      const plan = await prepareHermesRouteActivation({
        projectRoot: context.projectRoot,
        authorityProvider: context.authorityProvider,
        now: new Date()
      });
      return NextResponse.json({ plan }, noStore(200));
    }
    if (view !== "status") throw new Error("view must be plan or status");
    const status = await getHermesRouteActivationStatus({
      projectRoot: context.projectRoot,
      recordStore: context.recordStore,
      authorityProvider: context.authorityProvider,
      now: new Date()
    });
    return NextResponse.json({ status: publicStatus(status) }, noStore(200));
  } catch (error) {
    return activationErrorResponse(error);
  }
}

/**
 * Applies only the current server-derived route plan. The caller confirms one
 * content digest; controller target, workload identity, receipt store, and
 * tenant scope cannot be selected in the request body.
 */
export async function POST(request: Request) {
  const unauthorized = await authorizeRouteActivationRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const input = activationRequestSchema.parse(await readBoundedJson(request));
    const context = activationContext();
    const controller = controllerContext();
    await activateHermesRoutes({
      projectRoot: context.projectRoot,
      recordStore: context.recordStore,
      authorityProvider: context.authorityProvider,
      confirmationDigest: input.confirmationDigest,
      controllerUrl: controller.url,
      audience: controller.audience,
      tokenProvider: controller.tokenProvider,
      now: new Date()
    });
    const status = await getHermesRouteActivationStatus({
      projectRoot: context.projectRoot,
      recordStore: context.recordStore,
      authorityProvider: context.authorityProvider,
      now: new Date()
    });
    return NextResponse.json({ status: publicStatus(status) }, noStore(200));
  } catch (error) {
    return activationErrorResponse(error);
  }
}

function activationContext() {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const workspaceId = process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  return {
    projectRoot,
    recordStore: getHermesRouteActivationStore({ projectRoot, workspaceId }),
    authorityProvider: createHostedHermesRouteActivationAuthorityProvider({
      projectRoot,
      workspaceId
    })
  };
}

function authorizeRouteActivationRequest(request: Request) {
  return authorizeBearerApiRequest(request, {
    environmentVariable: "LOOPGRAPH_HERMES_ROUTE_ACTIVATION_API_TOKEN",
    credentialEnvironmentVariable: "LOOPGRAPH_HERMES_ROUTE_ACTIVATION_CREDENTIAL_ID",
    capability: "hermes.route_activation",
    rateLimit: 10
  });
}

function controllerContext(): {
  url: string;
  audience: string;
  tokenProvider: WorkloadTokenProvider;
} {
  const url = process.env.LOOPGRAPH_HERMES_ROUTE_CONTROLLER_URL?.trim();
  const audience = process.env.LOOPGRAPH_HERMES_ROUTE_CONTROLLER_AUDIENCE?.trim();
  if (!url || !audience) {
    throw new Error("Hosted Hermes route activation requires a configured controller URL and audience");
  }
  const tokenFile = process.env.LOOPGRAPH_HERMES_ROUTE_CONTROLLER_TOKEN_FILE?.trim();
  return {
    url,
    audience,
    tokenProvider: tokenFile
      ? new ProjectedFileWorkloadTokenProvider(tokenFile)
      : new AmbientWorkloadTokenProvider()
  };
}

function publicStatus(status: HermesRouteActivationStatus) {
  return {
    schemaVersion: "hosted-hermes-route-activation-status/v1alpha1" as const,
    checkedAt: status.checkedAt,
    exists: status.exists,
    current: status.current,
    ready: status.ready,
    ...(status.planDigest ? { planDigest: status.planDigest } : {}),
    ...(status.currentPlanDigest ? { currentPlanDigest: status.currentPlanDigest } : {}),
    routeStates: status.routeStates,
    warnings: status.warnings,
    nextActions: status.nextActions
  };
}

async function readBoundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ACTIVATION_BODY_BYTES) {
    throw new Error("Hermes route activation request exceeds 8 KiB");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_ACTIVATION_BODY_BYTES) {
    throw new Error("Hermes route activation request exceeds 8 KiB");
  }
  return JSON.parse(text) as unknown;
}

function activationErrorResponse(error: unknown) {
  const invalid = error instanceof ZodError;
  const conflict = error instanceof HermesRouteActivationError &&
    error.code === "confirmation_digest_mismatch";
  return NextResponse.json({
    error: invalid
      ? "Hermes route activation accepts only the versioned current-plan confirmation digest"
      : safeConnectorError(error, "Hermes route activation failed")
  }, noStore(conflict ? 409 : 400));
}

function noStore(status: number) {
  return {
    status,
    headers: { "cache-control": "no-store" }
  };
}
