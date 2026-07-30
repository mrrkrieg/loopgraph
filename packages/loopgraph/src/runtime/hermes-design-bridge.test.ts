import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getUniversalQuestionBundles,
  type QuestionBundleField
} from "../core";
import { generateDeterministicLoopDesign } from "./design-service";
import {
  confirmDiscoveryProjectContext,
  getNextDiscoveryQuestions,
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import {
  HttpHermesTaskTransport,
  getHermesDesignTask,
  processHermesDesignCallback,
  signHermesWebhookV2Payload,
  signLoopgraphTaskPayload,
  startHermesDesignTask,
  verifyHermesCallbackSignature,
  type HermesDesignRequest,
  type HermesTaskTransport
} from "./hermes-design-bridge";

describe("Hermes design bridge", () => {
  it("starts a durable task and sends a signed request to Hermes", async () => {
    const projectRoot = await tempProject();
    const session = await completeSession(projectRoot);
    const requests: HermesDesignRequest[] = [];
    const transport: HermesTaskTransport = {
      async dispatch(request) {
        requests.push(request);
        return {
          sent: true,
          destination: "https://hermes.test/tasks",
          responseStatus: 202,
          hermesTaskId: "hermes_remote_1"
        };
      }
    };

    const result = await startHermesDesignTask({
      projectRoot,
      sessionId: session.id,
      requestedBy: "browser",
      now: new Date("2026-07-29T11:00:00.000Z")
    }, { transport });

    expect(result.task.status).toBe("awaiting_hermes");
    expect(result.task.delivery).toEqual(expect.objectContaining({
      status: "sent",
      responseStatus: 202
    }));
    expect(result.request.context?.readiness).toBe("ready_for_design");
    expect(result.request.nextQuestions.length).toBeLessThanOrEqual(3);
    expect(requests).toHaveLength(1);
    expect(await getHermesDesignTask(result.task.id, projectRoot)).toEqual(result.task);
  });

  it("accepts an idempotent signed Hermes proposal callback through the existing compiler", async () => {
    const projectRoot = await tempProject();
    const session = await completeSession(projectRoot);
    const generated = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: session.id,
      department: "product",
      maxProposals: 1,
      now: new Date("2026-07-29T11:10:00.000Z")
    });
    const started = await startHermesDesignTask({
      projectRoot,
      sessionId: session.id,
      now: new Date("2026-07-29T11:15:00.000Z")
    }, {
      transport: {
        async dispatch() {
          return {
            sent: true,
            destination: "https://hermes.test/tasks",
            responseStatus: 202,
            hermesTaskId: "hermes_remote_2"
          };
        }
      }
    });
    const callback = {
      schemaVersion: "hermes-design-callback/v1alpha1",
      callbackId: "callback_product_design_1",
      taskId: started.task.id,
      hermesTaskId: "hermes_remote_2",
      occurredAt: "2026-07-29T11:20:00.000Z",
      type: "task.proposal_submitted",
      proposalSet: generated.proposalSet!,
      providerName: "hermes",
      modelIdentifier: "high-reasoning",
      providerMetadata: {}
    };

    const accepted = await processHermesDesignCallback({
      projectRoot,
      callback,
      now: new Date("2026-07-29T11:20:00.000Z")
    });
    const duplicate = await processHermesDesignCallback({
      projectRoot,
      callback,
      now: new Date("2026-07-29T11:21:00.000Z")
    });

    expect(accepted.task.status).toBe("completed");
    expect(accepted.designRunId).toBeTruthy();
    expect(accepted.validationErrors).toEqual([]);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.designRunId).toBe(accepted.designRunId);
  });

  it("signs outbound requests and rejects stale or altered callback signatures", async () => {
    const secret = "test-hermes-secret";
    const timestamp = "2026-07-29T12:00:00.000Z";
    const body = JSON.stringify({ taskId: "task_1" });
    const signature = signLoopgraphTaskPayload(body, timestamp, secret);

    expect(verifyHermesCallbackSignature({
      body,
      timestamp,
      signature,
      secret,
      now: new Date("2026-07-29T12:01:00.000Z")
    })).toBe(true);
    expect(verifyHermesCallbackSignature({
      body: `${body} `,
      timestamp,
      signature,
      secret,
      now: new Date("2026-07-29T12:01:00.000Z")
    })).toBe(false);
    expect(verifyHermesCallbackSignature({
      body,
      timestamp,
      signature,
      secret,
      now: new Date("2026-07-29T12:10:00.000Z")
    })).toBe(false);
  });

  it("uses the HTTP transport contract without exposing the signing secret", async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new HttpHermesTaskTransport({
      url: "https://hermes.test/tasks",
      secret: "transport-secret",
      now: () => new Date("2026-07-29T13:00:00.000Z"),
      fetchImpl: async (url, init) => {
        captured.push({ url: String(url), init });
        return new Response(JSON.stringify({ taskId: "remote_task_3" }), {
          status: 202,
          headers: { "content-type": "application/json" }
        });
      }
    });
    const request = {
      schemaVersion: "hermes-design-request/v1alpha1",
      event_type: "loopgraph.design_requested",
      task: {
        schemaVersion: "hermes-design-task/v1alpha1",
        id: "task_http_1",
        idempotencyKey: "idempotency_http_1",
        sessionId: "session_http_1",
        companyId: "company_http_1",
        department: "product",
        status: "queued",
        reason: "user_requested",
        originProblemIds: [],
        blockingGapIds: [],
        nextQuestionGapIds: [],
        designRunIds: [],
        compilerErrors: [],
        callbackIds: [],
        delivery: { status: "pending", attemptCount: 0 },
        requestedBy: "loopgraph",
        createdAt: "2026-07-29T13:00:00.000Z",
        updatedAt: "2026-07-29T13:00:00.000Z"
      },
      gaps: [],
      nextQuestions: [],
      allowedLoopgraphTools: [
        "loopgraph_opportunities_get",
        "loopgraph_evidence_gaps_get",
        "loopgraph_evidence_gap_answer",
        "loopgraph_design_context_get",
        "loopgraph_design_submit"
      ],
      instructions: []
    } satisfies HermesDesignRequest;

    const result = await transport.dispatch(request);

    expect(result).toEqual(expect.objectContaining({
      sent: true,
      hermesTaskId: "remote_task_3"
    }));
    expect(captured[0]?.init?.headers).toEqual(expect.objectContaining({
      "x-request-id": "idempotency_http_1",
      "x-loopgraph-task-id": "task_http_1",
      "x-webhook-timestamp": "1785330000",
      "x-webhook-signature-v2": signHermesWebhookV2Payload(
        String(captured[0]?.init?.body),
        "1785330000",
        "transport-secret"
      )
    }));
    expect(JSON.stringify(captured)).not.toContain("transport-secret");
  });
});

async function tempProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-design-bridge-"));
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "hermes-design-project",
    dependencies: {
      next: "^15.0.0",
      "@supabase/supabase-js": "^2.0.0"
    }
  }));
  return projectRoot;
}

async function completeSession(projectRoot: string) {
  let session = await startHermesDiscoverySession({
    projectRoot,
    sessionId: `session_${path.basename(projectRoot)}`,
    companyId: `company_${path.basename(projectRoot)}`,
    companyName: "Hermes Design Company",
    createdByActor: "hermes",
    now: new Date("2026-07-29T10:00:00.000Z")
  });
  const confirmed = await confirmDiscoveryProjectContext({
    projectRoot,
    sessionId: session.id,
    expectedRevision: session.revision,
    displayName: "Hermes Design Company",
    primaryGoal: "Improve product activation",
    northStarMetric: "Activation rate",
    additionalTools: ["PostHog", "GitHub", "Intercom"],
    confirmedStack: true,
    actor: "hermes",
    now: new Date("2026-07-29T10:01:00.000Z")
  });
  session = await selectDiscoveryDepartments({
    projectRoot,
    sessionId: session.id,
    departments: ["product"],
    activeDepartment: "product",
    expectedRevision: confirmed.session.revision,
    actor: "hermes",
    now: new Date("2026-07-29T10:02:00.000Z")
  });

  for (const bundle of getUniversalQuestionBundles("product")) {
    const next = await getNextDiscoveryQuestions({ projectRoot, sessionId: session.id });
    expect(next.bundle?.id).toBe(bundle.id);
    session = await submitDiscoveryAnswers({
      projectRoot,
      sessionId: session.id,
      bundleId: bundle.id,
      expectedRevision: session.revision,
      actor: "hermes",
      answers: Object.fromEntries(bundle.fields
        .filter((field) => field.required || [
          "event_sources_subjects",
          "problem_signal",
          "baseline",
          "baseline_target",
          "completion_signal",
          "failure_signal"
        ].includes(field.id))
        .map((field) => [field.id, answerForField(field)])),
      now: new Date(new Date("2026-07-29T10:03:00.000Z").getTime() + session.revision * 1000)
    });
  }
  return session;
}

function answerForField(field: QuestionBundleField): unknown {
  const values: Record<string, unknown> = {
    systems: ["PostHog", "GitHub", "Intercom"],
    source_of_truth: "PostHog workspace and GitHub repository",
    event_sources_subjects: "PostHog activation alert for workspace_id",
    safe_reads: ["Activation funnels", "Support issue metadata", "Release metadata"],
    processes: ["Activation issue detection", "Feedback clustering"],
    trigger_or_cadence: "Product analytics threshold event",
    problem_signal: "Activation rate drops below the rolling baseline",
    current_owner: "Product lead",
    current_steps: ["Inspect funnel", "Correlate releases", "Review support evidence"],
    pain_type_severity: "High delay and missed product evidence",
    baseline: "Five days to identify and resolve activation regressions",
    desired_automation_mode: "Prepare and recommend",
    candidate_outputs_actions: ["Draft evidence-backed product problem brief"],
    read_write_boundary: "Read-only evidence; draft issues require review",
    customer_facing_status: false,
    forbidden_actions: ["No roadmap or customer communication changes"],
    primary_outcome_metric: "Activation recovery time",
    guardrail_metric: "Support burden must not increase",
    baseline_target: "Reduce recovery time from five days to two days",
    verification_rules: ["Cite funnel, release, and support evidence"],
    completion_signal: ["Activation returns above target for seven days"],
    failure_signal: ["Verifier rejection", "No recovery after evaluation window"],
    loop_owner_role: "Product lead",
    reviewer_roles: ["Product manager", "Engineering lead"],
    escalation_conditions: ["Critical activation decline lasting more than one day"],
    initial_autonomy_level: "shadow"
  };
  if (field.id in values) return values[field.id];
  if (field.valueType === "string_array") return [`Confirmed ${field.label}`];
  if (field.valueType === "number") return 10;
  if (field.valueType === "boolean") return false;
  if (field.valueType === "object") return { confirmed: true };
  return `Confirmed ${field.label}`;
}
