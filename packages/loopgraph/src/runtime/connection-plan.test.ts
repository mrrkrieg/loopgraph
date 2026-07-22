import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_INSTANCE_SCHEMA_VERSION,
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  createEventEnvelopeId,
  eventEnvelopeSchema,
  type EventEnvelope
} from "../core";
import { buildConnectionPlan, setManualConnectionFallback } from "./connection-plan";
import { FileRoutingStore } from "./routing-store";
import { loopgraph_events_ingest, loopgraph_routing_catalog_get } from "./routing-tools";

async function createProjectWithAdsSpec(): Promise<{ projectRoot: string; specPath: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-connections-"));
  const specPath = path.join(projectRoot, "loops", "marketing-ads.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(marketingAdsSpec(), null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "marketing_ads",
      name: "Ads",
      path: path.relative(projectRoot, specPath),
      department: "marketing",
      addedAt: "2026-07-21T12:00:00.000Z"
    }]
  }, null, 2)}\n`);

  return { projectRoot, specPath };
}

async function createProjectWithGitHubSpec(): Promise<{ projectRoot: string; specPath: string }> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-connections-github-"));
  const specPath = path.join(projectRoot, "loops", "github-issue-triage.loopgraph.json");
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(githubIssueTriageSpec(), null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "github_issue_triage",
      name: "GitHub Issue Triage",
      path: path.relative(projectRoot, specPath),
      department: "engineering",
      addedAt: "2026-07-21T12:00:00.000Z"
    }]
  }, null, 2)}\n`);

  return { projectRoot, specPath };
}

function marketingAdsSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "marketing_ads",
      name: "Ads",
      version: "1.0.0",
      description: "Improve qualified acquisition efficiency."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe campaign signals." }]
    },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft review", writeCapable: false, riskLevel: "low" }],
    policy: {
      allowedActions: [{ toolKey: "draft_review", allowed: true, requiresApproval: false, riskLevel: "low" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "marketing" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["paid_acquisition_efficiency_drop"],
      accepts: [{
        sourcePattern: "google_ads*",
        eventTypePattern: "campaign.*",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct", "signals.costPerQualifiedCustomerDeltaPct"]
      }],
      inputMapping: { campaignId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow",
      requiredConnections: ["ads.read"]
    },
    studioExtension: {
      hermesDesign: {
        proposalId: "proposal_marketing_ads",
        connectorRequirements: [{
          capability: "ads.read",
          reason: "Read campaign spend, audience, and creative performance.",
          requiredFor: "routing"
        }],
        requiredFromUser: [{
          type: "connection",
          label: "Connect ads read data or provide fixture export",
          reason: "The loop needs spend and campaign signals."
        }]
      }
    }
  };
}

function githubIssueTriageSpec() {
  return {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: {
      id: "github_issue_triage",
      name: "GitHub Issue Triage",
      version: "1.0.0",
      description: "Prepare issue labels and responses from repository policy."
    },
    trigger: { type: "event", source: "hermes", event: "business_event" },
    input: { schema: { type: "object" } },
    output: {
      schema: {
        type: "object",
        required: ["decisionSummary", "proposedActions", "evidence", "policyInputs", "verificationRequest"],
        properties: {
          decisionSummary: { type: "string" },
          proposedActions: { type: "array" },
          evidence: { type: "array" },
          policyInputs: { type: "array" },
          verificationRequest: { type: "object" }
        }
      }
    },
    context: { sources: [], precedence: [] },
    routine: {
      steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe GitHub issue context." }]
    },
    tools: [{ key: "draft_response", adapterId: "github", label: "Draft response", writeCapable: true, riskLevel: "medium" }],
    policy: {
      allowedActions: [{ toolKey: "draft_response", allowed: true, requiresApproval: true, riskLevel: "medium" }],
      forbiddenActions: [],
      escalationRules: []
    },
    verification: [],
    approval: { requireFingerprintMatch: true, separateCustomerFacingApproval: true, allowedRoles: ["owner"] },
    persistence: { idempotency: { enabled: true } },
    trace: { captureContextSnapshot: true, captureToolInputOutput: true, evidenceRequired: true },
    topology: { department: "engineering" },
    routing: {
      schemaVersion: "routing-contract/v1alpha1",
      problemTypes: ["github_issue_needs_triage"],
      accepts: [{
        sourcePattern: "github*",
        eventTypePattern: "issues.*",
        subjectTypes: ["issue"],
        requiredFields: ["issue.number", "issue.title"]
      }],
      inputMapping: { issueNumber: "issue.number" },
      minimumConfidence: 0.8,
      activationMode: "shadow",
      requiredConnections: ["issue_tracker.read"]
    },
    studioExtension: {
      hermesDesign: {
        proposalId: "proposal_github_issue_triage",
        connectorRequirements: [
          {
            capability: "issue_tracker.read",
            reason: "Read issue title, body, labels, and repository policy.",
            requiredFor: "routing"
          },
          {
            capability: "issue_tracker.draft_write",
            reason: "Prepare issue response drafts for human review.",
            requiredFor: "execution"
          },
          {
            capability: "issue_tracker.approved_write",
            reason: "Apply approved labels or comments only after fingerprint-bound review.",
            requiredFor: "execution"
          }
        ],
        requiredFromUser: [{
          type: "connection",
          label: "Connect GitHub read access or provide a redacted issue export",
          reason: "The loop needs issue context before Hermes can route or simulate it safely."
        }]
      }
    }
  };
}

function adsEvent(sourceDeliveryId: string): EventEnvelope {
  const base = {
    workspaceId: "workspace_1",
    companyId: "company_1",
    source: "google_ads_detector",
    sourceDeliveryId,
    eventType: "campaign.performance_anomaly"
  };

  return eventEnvelopeSchema.parse({
    id: createEventEnvelopeId(base),
    ...base,
    sourceRoute: "hermes.google_ads_detector",
    occurredAt: "2026-07-21T12:00:00.000Z",
    receivedAt: "2026-07-21T12:00:01.000Z",
    subject: { type: "campaign", id: "campaign_123" },
    correlationId: "corr_campaign_123",
    normalizedPayload: {
      signals: {
        spendDeltaPct: 18,
        costPerQualifiedCustomerDeltaPct: 31
      }
    },
    trust: { signatureVerified: true, signer: "google_ads", untrustedFields: [] }
  });
}

describe("Hermes connection planning", () => {
  it("blocks Hermes routing when a required capability is missing and degrades after explicit manual fallback", async () => {
    const { projectRoot } = await createProjectWithAdsSpec();

    const missingPlan = await buildConnectionPlan({
      projectRoot,
      now: new Date("2026-07-21T12:01:00.000Z")
    });

    expect(missingPlan.summary.readyForRouting).toBe(false);
    expect(missingPlan.items).toContainEqual(expect.objectContaining({
      capability: "ads.read",
      status: "missing",
      blockingFor: ["routing"],
      authority: {
        hermesReceivesEvents: true,
        loopgraphCanRead: true,
        loopgraphCanWrite: false,
        notes: expect.arrayContaining([
          expect.stringContaining("Provider webhooks for this capability should terminate at Hermes"),
          expect.stringContaining("Loopgraph can read this source only through a connected read instance")
        ])
      },
      suggestedConnectors: expect.arrayContaining([
        expect.objectContaining({
          manifestId: "google_ads",
          label: "Google Ads",
          category: "ads",
          transport: "http_api",
          authType: "oauth2",
          capabilities: ["ads.read"],
          minimumScopes: ["https://www.googleapis.com/auth/adwords"],
          manualFallback: "Provide a redacted Google Ads CSV export."
        }),
        expect.objectContaining({
          manifestId: "manual_file",
          label: "Manual File Import",
          transport: "file_import",
          authType: "manual"
        })
      ]),
      webhookRouteHints: expect.arrayContaining([
        expect.objectContaining({
          manifestId: "google_ads",
          routeNameTemplate: "loopgraph-google-ads-events",
          sourcePatterns: ["google_ads*"],
          eventTypePatterns: ["campaign.*"],
          transformVersion: "google-ads-event-envelope/v1alpha1"
        })
      ]),
      loops: expect.arrayContaining([expect.objectContaining({
        loopId: "marketing_ads",
        department: "marketing",
        requiredFor: "routing"
      })])
    }));

    const blockedCatalog = await loopgraph_routing_catalog_get({ projectRoot });
    expect(blockedCatalog.routingCards[0]).toMatchObject({
      loopId: "marketing_ads",
      currentReadiness: "blocked",
      requiredConnections: ["ads.read"]
    });

    const blockedIngest = await loopgraph_events_ingest({ projectRoot, event: adsEvent("delivery_blocked") }, {
      store: new FileRoutingStore(path.join(projectRoot, ".loopgraph")),
      now: new Date("2026-07-21T12:02:00.000Z")
    });
    expect(blockedIngest.eligibleRoutes).toHaveLength(0);

    const fallbackResult = await setManualConnectionFallback({
      projectRoot,
      capability: "ads.read",
      label: "Use weekly ads export fixture",
      instructions: "Import a redacted CSV export for local shadow routing.",
      updatedBy: "user",
      now: new Date("2026-07-21T12:03:00.000Z")
    });
    expect(fallbackResult.plan.summary.readyForRouting).toBe(true);
    expect(fallbackResult.plan.summary.readyForExecution).toBe(true);
    expect(fallbackResult.plan.items).toContainEqual(expect.objectContaining({
      capability: "ads.read",
      status: "manual_fallback",
      blockingFor: [],
      manualFallbacks: expect.arrayContaining(["Use weekly ads export fixture"])
    }));

    const degradedCatalog = await loopgraph_routing_catalog_get({ projectRoot });
    expect(degradedCatalog.routingCards[0]).toMatchObject({
      loopId: "marketing_ads",
      currentReadiness: "degraded"
    });

    const degradedIngest = await loopgraph_events_ingest({ projectRoot, event: adsEvent("delivery_degraded") }, {
      store: new FileRoutingStore(path.join(projectRoot, ".loopgraph")),
      now: new Date("2026-07-21T12:04:00.000Z")
    });
    expect(degradedIngest.eligibleRoutes.map((route) => route.card.loopId)).toEqual(["marketing_ads"]);
  });

  it("marks capabilities connected from compatible non-secret connection instances", async () => {
    const { projectRoot } = await createProjectWithAdsSpec();
    const instancesPath = path.join(projectRoot, ".loopgraph", "connections", "instances.json");
    await mkdir(path.dirname(instancesPath), { recursive: true });
    await writeFile(instancesPath, `${JSON.stringify({
      schemaVersion: CONNECTION_INSTANCE_SCHEMA_VERSION,
      instances: [{
        schemaVersion: CONNECTION_INSTANCE_SCHEMA_VERSION,
        id: "conn_google_ads_read",
        manifestId: "google_ads",
        accountLabel: "Production Google Ads",
        capabilityKeys: ["ads.read"],
        credentialRef: "keychain://loopgraph/google-ads/read",
        grantedScopes: ["https://www.googleapis.com/auth/adwords"],
        status: "connected",
        environment: "sandbox",
        readPolicy: "read_only",
        writePolicy: "not_allowed",
        lastHealthCheckAt: "2026-07-21T12:00:00.000Z"
      }]
    }, null, 2)}\n`);

    const plan = await buildConnectionPlan({
      projectRoot,
      now: new Date("2026-07-21T12:05:00.000Z")
    });

    expect(plan.summary).toMatchObject({
      missingCapabilities: 0,
      connectedCapabilities: 1,
      readyForRouting: true,
      readyForSimulation: true,
      readyForExecution: true
    });
    expect(plan.items).toContainEqual(expect.objectContaining({
      capability: "ads.read",
      status: "connected",
      blockingFor: [],
      compatibleConnections: [{
        instanceId: "conn_google_ads_read",
        manifestId: "google_ads",
        label: "Production Google Ads",
        status: "connected",
        environment: "sandbox"
      }]
    }));
  });

  it("models GitHub as Hermes-routed connector capabilities instead of a direct webhook brain", async () => {
    const { projectRoot } = await createProjectWithGitHubSpec();

    const plan = await buildConnectionPlan({
      projectRoot,
      now: new Date("2026-07-21T12:06:00.000Z")
    });

    expect(plan.items).toContainEqual(expect.objectContaining({
      capability: "issue_tracker.read",
      status: "missing",
      blockingFor: ["routing"],
      authority: {
        hermesReceivesEvents: true,
        loopgraphCanRead: true,
        loopgraphCanWrite: false,
        notes: expect.arrayContaining([
          expect.stringContaining("Provider webhooks for this capability should terminate at Hermes"),
          expect.stringContaining("Loopgraph can read this source only through a connected read instance")
        ])
      },
      suggestedConnectors: expect.arrayContaining([
        expect.objectContaining({
          manifestId: "github",
          label: "GitHub",
          category: "repository",
          transport: "native_adapter",
          authType: "provider_app",
          capabilities: ["issue_tracker.read"],
          minimumScopes: ["metadata:read", "issues:read"],
          manualFallback: "Provide a redacted GitHub issue JSON export."
        }),
        expect.objectContaining({
          manifestId: "manual_file",
          label: "Manual File Import",
          transport: "file_import",
          authType: "manual"
        })
      ]),
      webhookRouteHints: expect.arrayContaining([
        expect.objectContaining({
          manifestId: "github",
          routeNameTemplate: "loopgraph-github-events",
          sourcePatterns: ["github*"],
          eventTypePatterns: ["issues.*", "issue_comment.*", "pull_request.*", "repository.*"],
          transformVersion: "github-event-envelope/v1alpha1",
          stableDeliveryId: "x-github-delivery"
        })
      ])
    }));
    expect(plan.items).toContainEqual(expect.objectContaining({
      capability: "issue_tracker.draft_write",
      authority: expect.objectContaining({
        hermesReceivesEvents: true,
        loopgraphCanRead: false,
        loopgraphCanWrite: true
      }),
      suggestedConnectors: expect.arrayContaining([
        expect.objectContaining({
          manifestId: "github",
          capabilities: ["issue_tracker.draft_write"],
          minimumScopes: ["issues:write"]
        })
      ])
    }));
    expect(plan.items).toContainEqual(expect.objectContaining({
      capability: "issue_tracker.approved_write",
      authority: expect.objectContaining({
        hermesReceivesEvents: true,
        loopgraphCanWrite: true
      }),
      suggestedConnectors: expect.arrayContaining([
        expect.objectContaining({
          manifestId: "github",
          capabilities: ["issue_tracker.approved_write"],
          minimumScopes: ["issues:write"]
        })
      ])
    }));
  });
});
