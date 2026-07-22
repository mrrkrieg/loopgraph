import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loopgraph_routing_human_choice_submit } from "loopgraph/runtime";

const humanChoiceRequestSchema = z.object({
  eventId: z.string().min(1),
  routeAttemptId: z.string().min(1).optional(),
  problemId: z.string().min(1).optional(),
  action: z.enum(["route", "unhandled", "defer", "ignore"]).default("route"),
  selectedLoopIds: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1),
  correctedBy: z.string().min(1).default("browser-operator")
}).superRefine((value, context) => {
  if (value.action === "route" && value.selectedLoopIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedLoopIds"],
      message: "selectedLoopIds is required when action=route"
    });
  }
  if (value.action !== "route" && value.selectedLoopIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedLoopIds"],
      message: "selectedLoopIds must be empty unless action=route"
    });
  }
});

export async function POST(request: Request) {
  const parsedBody = await parseHumanChoiceRequest(request);
  const parsed = humanChoiceRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      error: "Invalid human routing correction",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    }, { status: 400 });
  }

  try {
    const result = await loopgraph_routing_human_choice_submit({
      projectRoot: getBrowserProjectRoot(),
      eventId: parsed.data.eventId,
      routeAttemptId: parsed.data.routeAttemptId,
      problemId: parsed.data.problemId,
      action: parsed.data.action,
      selectedLoopIds: parsed.data.selectedLoopIds,
      reason: parsed.data.reason,
      correctedBy: parsed.data.correctedBy,
      hermesMetadata: {
        source: "browser-management-routing-ops"
      }
    });

    if (isFormRequest(request)) {
      return NextResponse.redirect(new URL("/management", request.url), { status: 303 });
    }

    return NextResponse.json({
      ok: result.submission.valid,
      correction: result.correction,
      submission: result.submission,
      selectedCards: result.selectedCards
    }, { status: result.submission.valid ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to submit human routing correction"
    }, { status: 400 });
  }
}

async function parseHumanChoiceRequest(request: Request): Promise<unknown> {
  if (isFormRequest(request)) {
    const form = await request.formData();
    const selectedLoopIds = String(form.get("selectedLoopIds") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      eventId: String(form.get("eventId") ?? ""),
      routeAttemptId: optionalFormString(form.get("routeAttemptId")),
      problemId: optionalFormString(form.get("problemId")),
      action: String(form.get("action") ?? "route"),
      selectedLoopIds,
      reason: String(form.get("reason") ?? ""),
      correctedBy: String(form.get("correctedBy") ?? "browser-operator")
    };
  }

  return request.json().catch(() => ({}));
}

function isFormRequest(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") ||
    (request.headers.get("content-type") ?? "").includes("multipart/form-data");
}

function optionalFormString(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
}

function getBrowserProjectRoot(): string {
  return path.resolve(process.env.LOOPGRAPH_PROJECT_ROOT ?? process.cwd());
}
