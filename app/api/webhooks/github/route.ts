import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { loadLoopSpecFromPath } from "@/lib/loopgraph-runtime/loader";
import { executeLoop } from "@/lib/loopgraph-runtime/executor";
import { getStorageAdapter } from "@/lib/loopgraph-runtime/storage-resolver";
import { recordIngestedEvent } from "@/lib/loopgraph-sdk/supabase-storage";
import path from "node:path";

function verifyGithubSignature(payload: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = `sha256=${digest}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const deliveryId = request.headers.get("x-github-delivery") ?? randomUUID();

  if (!verifyGithubSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  if (event !== "issues") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const payload = JSON.parse(rawBody) as {
    action?: string;
    issue?: { number: number; title: string; body: string; labels?: Array<{ name: string }> };
  };

  if (payload.action !== "opened" || !payload.issue) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const eventId = `gh_${payload.issue.number}_${deliveryId}`;
  const dedupe = await recordIngestedEvent({ deliveryId, source: "github", eventId });
  if (dedupe.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const specPath = path.join(process.cwd(), "examples/github-issue-triage");
  const loaded = await loadLoopSpecFromPath(specPath);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.errors.join("\n") }, { status: 500 });
  }

  const triggerPayload = {
    eventId,
    issue: {
      number: payload.issue.number,
      title: payload.issue.title,
      body: payload.issue.body,
      labels: (payload.issue.labels ?? []).map((label) => label.name)
    },
    repo: {
      name: `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`,
      policy: "Live GitHub webhook trigger"
    }
  };

  try {
    const result = await executeLoop({
      spec: loaded.spec,
      triggerPayload,
      eventId,
      storage: getStorageAdapter()
    });

    return NextResponse.json({
      ok: true,
      runId: result.trace.id,
      status: result.trace.status,
      summary: result.summary
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Execute failed" }, { status: 500 });
  }
}
