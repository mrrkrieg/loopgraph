import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_INSTALL_SCHEMA_VERSION,
  LOOPGRAPH_API_VERSION,
  LOOP_KIND,
  canonicalAppDigest,
  workspaceAppInstallationSchema,
  type HermesRouteControllerRequest
} from "../core";
import { appInstallationRegistrySchema } from "./app-installation-store";
import {
  activateHermesRoutes,
  activationRecordPath,
  getHermesRouteActivationStatus,
  prepareHermesRouteActivation
} from "./hermes-route-activation";
import { syncHermesWebhookRoutes } from "./hermes-webhooks";
import { writeConnectionInstances } from "./connector-registry";
import type { WorkloadTokenProvider } from "./workload-token-provider";

describe("Hermes route activation", () => {
  it("prepares Hermes-generated business-event routes without a provider subscription", async () => {
    const projectRoot = await createProject();
    const specPath = path.join(projectRoot, "loops", "marketing_ads.loopgraph.json");
    const spec = JSON.parse(await readFile(specPath, "utf8")) as {
      routing: { accepts: Array<{ sourcePattern: string; eventTypePattern: string }> };
    };
    spec.routing.accepts[0]!.sourcePattern = "hermes";
    spec.routing.accepts[0]!.eventTypePattern = "marketing.campaign_evidence_ready";
    await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    await syncHermesWebhookRoutes({ projectRoot, now: new Date("2026-08-23T11:58:00.000Z") });

    const plan = await prepareHermesRouteActivation({
      projectRoot,
      now: new Date("2026-08-23T11:59:00.000Z")
    });

    expect(plan.routes).toContainEqual(expect.objectContaining({
      routeKind: "internal_business_event",
      sourcePattern: "hermes",
      transformation: expect.objectContaining({ transformerId: "hermes-business-event-envelope/v1alpha1" }),
      subscription: {
        owner: "hermes",
        policy: "notification_only",
        connectionIds: [],
        required: false
      }
    }));
  });

  it("specializes provider-agnostic loop routes to each connected reviewed transformer", async () => {
    const projectRoot = await createProject();
    const specPath = path.join(projectRoot, "loops", "marketing_ads.loopgraph.json");
    const spec = JSON.parse(await readFile(specPath, "utf8")) as {
      routing: { accepts: Array<{ sourcePattern: string; eventTypePattern: string }> };
    };
    spec.routing.accepts[0]!.sourcePattern = "*";
    spec.routing.accepts[0]!.eventTypePattern = "lead.created";
    await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    await syncHermesWebhookRoutes({ projectRoot, now: new Date("2026-08-23T11:58:00.000Z") });
    await writeConnectionInstances(projectRoot, [{
      schemaVersion: "connection-instance/v1alpha1",
      id: "connection_hubspot_1",
      manifestId: "hubspot",
      source: "hermes_connector_broker",
      brokerCapabilities: ["provider.webhooks.subscribe", "provider.webhooks.verify"],
      capabilityKeys: ["crm.read", "crm.events"],
      grantedScopes: ["crm.objects.contacts.read"],
      status: "connected",
      environment: "sandbox",
      readPolicy: "read_only",
      writePolicy: "not_allowed"
    }]);

    const plan = await prepareHermesRouteActivation({
      projectRoot,
      now: new Date("2026-08-23T11:59:00.000Z")
    });

    expect(plan.routes).toContainEqual(expect.objectContaining({
      routeKind: "provider_event",
      sourcePattern: "hubspot*",
      loopIds: ["marketing_ads"],
      transformation: expect.objectContaining({ transformerId: "hubspot-event-envelope/v1alpha1" }),
      subscription: expect.objectContaining({
        connectionIds: ["connection_hubspot_1"],
        required: true
      })
    }));
    expect(plan.routes.some((route) => route.routeName.startsWith("loopgraph-hubspot-events-"))).toBe(true);
  });

  it("uses the App installation's exact provider binding for wildcard routes", async () => {
    const projectRoot = await createProject();
    const originalSpecPath = path.join(projectRoot, "loops", "marketing_ads.loopgraph.json");
    const spec = JSON.parse(await readFile(originalSpecPath, "utf8")) as {
      routing: {
        accepts: Array<{ sourcePattern: string; eventTypePattern: string }>;
        requiredConnections: string[];
      };
    };
    spec.routing.accepts[0]!.sourcePattern = "*";
    spec.routing.accepts[0]!.eventTypePattern = "lead.created";
    spec.routing.requiredConnections = ["crm.lead.read"];
    const installationId = "install.sales";
    const installedSpecPath = path.join(
      projectRoot,
      ".loopgraph",
      "apps",
      "installations",
      installationId,
      "generated",
      "loops",
      "marketing_ads.loopgraph.json"
    );
    await mkdir(path.dirname(installedSpecPath), { recursive: true });
    await writeFile(installedSpecPath, `${JSON.stringify(spec, null, 2)}\n`);
    await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
      version: 1,
      demoCatalogEnabled: false,
      registeredSpecs: [{
        id: "marketing_ads",
        name: "Ads",
        path: path.relative(projectRoot, installedSpecPath),
        department: "marketing",
        addedAt: "2026-08-23T12:00:00.000Z"
      }]
    }, null, 2)}\n`);
    await writeAppInstallationRegistry(projectRoot, installationId, "connection_hubspot_1");
    await syncHermesWebhookRoutes({ projectRoot, now: new Date("2026-08-23T11:58:00.000Z") });
    await writeConnectionInstances(projectRoot, [
      {
        schemaVersion: "connection-instance/v1alpha1",
        id: "connection_hubspot_1",
        manifestId: "hubspot",
        source: "hermes_connector_broker",
        brokerCapabilities: ["provider.webhooks.subscribe", "provider.webhooks.verify"],
        capabilityKeys: ["crm.read", "crm.events"],
        grantedScopes: ["crm.objects.contacts.read"],
        status: "connected",
        environment: "sandbox",
        readPolicy: "read_only",
        writePolicy: "not_allowed"
      },
      {
        schemaVersion: "connection-instance/v1alpha1",
        id: "connection_google_ads_1",
        manifestId: "google_ads",
        source: "hermes_connector_broker",
        brokerCapabilities: ["provider.webhooks.subscribe", "provider.webhooks.verify"],
        capabilityKeys: ["ads.read", "ads.events"],
        grantedScopes: ["https://www.googleapis.com/auth/adwords"],
        status: "connected",
        environment: "sandbox",
        readPolicy: "read_only",
        writePolicy: "not_allowed"
      }
    ]);

    const plan = await prepareHermesRouteActivation({
      projectRoot,
      now: new Date("2026-08-23T11:59:00.000Z")
    });

    const appRoutes = plan.routes.filter((route) => route.loopIds.includes("marketing_ads"));
    expect(appRoutes).toHaveLength(1);
    expect(appRoutes[0]).toMatchObject({
      sourcePattern: "hubspot*",
      requiredCapabilities: ["crm.lead.read"],
      transformation: { transformerId: "hubspot-event-envelope/v1alpha1" },
      subscription: { connectionIds: ["connection_hubspot_1"], required: true }
    });
  });

  it("prepares a content-bound, secret-free controller plan from a current route manifest", async () => {
    const projectRoot = await createProject();
    await syncHermesWebhookRoutes({ projectRoot, now: new Date("2026-08-23T12:00:00.000Z") });
    await writeConnectionInstances(projectRoot, [{
      schemaVersion: "connection-instance/v1alpha1",
      id: "connection_google_ads_1",
      manifestId: "google_ads",
      source: "hermes_connector_broker",
      brokerCapabilities: ["provider.webhooks.subscribe", "provider.webhooks.verify"],
      capabilityKeys: ["ads.events"],
      grantedScopes: ["https://www.googleapis.com/auth/adwords"],
      status: "connected",
      environment: "sandbox",
      readPolicy: "read_only",
      writePolicy: "not_allowed"
    }]);

    const plan = await prepareHermesRouteActivation({
      projectRoot,
      now: new Date("2026-08-23T12:01:00.000Z")
    });

    expect(plan).toMatchObject({
      schemaVersion: "hermes-route-activation-plan/v1alpha1",
      controllerProtocol: "hermes-route-controller-request/v1alpha1",
      destructiveChangesAllowed: false,
      routes: expect.arrayContaining([
        expect.objectContaining({
          routeName: "loopgraph-google-ads-events",
          profileId: "loopgraph_webhook_router",
          activationMode: "shadow",
          transformation: {
            transformerId: "google-ads-event-envelope/v1alpha1",
            outputSchema: "EventEnvelope",
            dropsRawPayload: true,
            stableDeliveryIdRequired: true
          },
          subscription: {
            owner: "hermes",
            policy: "configure_if_connected",
            connectionIds: ["connection_google_ads_1"],
            required: true
          }
        }),
        expect.objectContaining({
          routeName: "loopgraph-lifecycle-events",
          profileId: "loopgraph_lifecycle_router",
          subscription: {
            owner: "hermes",
            policy: "notification_only",
            connectionIds: [],
            required: false
          }
        })
      ])
    });
    expect(plan.planDigest).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(plan)).not.toMatch(/Bearer|access_token|client_secret/);
  });

  it("applies only the confirmed plan and persists an exact secret-free receipt", async () => {
    const projectRoot = await createProject();
    await syncHermesWebhookRoutes({ projectRoot, now: new Date("2026-08-23T12:00:00.000Z") });
    await writeConnectionInstances(projectRoot, [{
      schemaVersion: "connection-instance/v1alpha1",
      id: "connection_google_ads_1",
      manifestId: "google_ads",
      source: "hermes_connector_broker",
      brokerCapabilities: ["provider.webhooks.subscribe", "provider.webhooks.verify"],
      capabilityKeys: ["ads.events"],
      grantedScopes: [],
      status: "connected",
      environment: "sandbox",
      readPolicy: "read_only",
      writePolicy: "not_allowed"
    }]);
    const now = new Date("2026-08-23T12:02:00.000Z");
    const plan = await prepareHermesRouteActivation({ projectRoot, now });
    const token = "header.payload.signature-with-enough-entropy-for-tests";
    const tokenProvider: WorkloadTokenProvider = {
      getToken: async ({ audience }) => {
        expect(audience).toBe("hermes-controller");
        return token;
      }
    };
    let request: HermesRouteControllerRequest | undefined;
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      request = JSON.parse(String(init?.body)) as HermesRouteControllerRequest;
      return Response.json(controllerReceipt(request));
    };

    const record = await activateHermesRoutes({
      projectRoot,
      now,
      controllerUrl: "https://hermes.example.test/v1/loopgraph/routes/reconcile",
      audience: "hermes-controller",
      confirmationDigest: plan.planDigest,
      tokenProvider,
      fetcher: fetcher as typeof fetch
    });

    expect(request?.operation).toBe("reconcile_shadow_routes");
    expect(request?.destructiveChangesAllowed).toBe(false);
    expect(record.ready).toBe(true);
    expect(record.receipt.destructiveChangesApplied).toBe(false);
    const serialized = await readFile(activationRecordPath(projectRoot), "utf8");
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("authorization");
    if (process.platform !== "win32") {
      expect((await stat(activationRecordPath(projectRoot))).mode & 0o777).toBe(0o600);
    }
    const statusResult = await getHermesRouteActivationStatus({ projectRoot, now });
    expect(statusResult).toMatchObject({ exists: true, current: true, ready: true });

    const tampered = JSON.parse(serialized) as { receipt: { routes: Array<{ restrictedMcpTools: string[] }> } };
    tampered.receipt.routes[0]!.restrictedMcpTools = ["loopgraph_graph_get"];
    await writeFile(activationRecordPath(projectRoot), `${JSON.stringify(tampered, null, 2)}\n`);
    await expect(getHermesRouteActivationStatus({ projectRoot, now }))
      .rejects.toMatchObject({ code: "activation_record_invalid" });
  });

  it("refuses stale confirmation and receipts that weaken the requested route contract", async () => {
    const projectRoot = await createProject();
    await syncHermesWebhookRoutes({ projectRoot, now: new Date("2026-08-23T12:00:00.000Z") });
    const now = new Date("2026-08-23T12:03:00.000Z");
    const plan = await prepareHermesRouteActivation({ projectRoot, now });
    const tokenProvider: WorkloadTokenProvider = { getToken: async () => "header.payload.signature-with-enough-entropy-for-tests" };

    await expect(activateHermesRoutes({
      projectRoot,
      now,
      controllerUrl: "https://hermes.example.test/v1/loopgraph/routes/reconcile",
      audience: "hermes-controller",
      confirmationDigest: "0000000000000000",
      tokenProvider,
      fetcher: (() => { throw new Error("must not be called"); }) as typeof fetch
    })).rejects.toMatchObject({ code: "confirmation_digest_mismatch" });

    await expect(activateHermesRoutes({
      projectRoot,
      now,
      controllerUrl: "https://hermes.example.test/v1/loopgraph/routes/reconcile",
      audience: "hermes-controller",
      confirmationDigest: plan.planDigest,
      tokenProvider,
      fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as HermesRouteControllerRequest;
        const receipt = controllerReceipt(request);
        receipt.routes[0]!.restrictedMcpTools = ["loopgraph_graph_get"];
        return Response.json(receipt);
      }) as typeof fetch
    })).rejects.toMatchObject({ code: "controller_receipt_contract_mismatch" });

    await expect(activateHermesRoutes({
      projectRoot,
      now,
      controllerUrl: "https://hermes.example.test/v1/loopgraph/routes/reconcile",
      audience: "hermes-controller",
      confirmationDigest: plan.planDigest,
      tokenProvider,
      fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as HermesRouteControllerRequest;
        const receipt = controllerReceipt(request);
        const providerRoute = receipt.routes.find((_route, index) => request.routes[index]?.subscription.required);
        if (!providerRoute) throw new Error("Expected a provider route");
        providerRoute.subscriptionState = "not_applicable";
        return Response.json(receipt);
      }) as typeof fetch
    })).rejects.toMatchObject({ code: "controller_receipt_subscription_mismatch" });

    await expect(readFile(activationRecordPath(projectRoot), "utf8")).rejects.toThrow();
  });
});

function controllerReceipt(request: HermesRouteControllerRequest) {
  return {
    schemaVersion: "hermes-route-controller-receipt/v1alpha1" as const,
    requestId: request.requestId,
    controllerInstanceId: "hermes_controller_test_1",
    appliedAt: request.requestedAt,
    projectRootHash: request.projectRootHash,
    catalogVersion: request.catalogVersion,
    manifestDigest: request.manifestDigest,
    planDigest: request.planDigest,
    destructiveChangesApplied: false as const,
    routes: request.routes.map((route) => ({
      routeId: route.routeId,
      routeName: route.routeName,
      state: "shadow" as const,
      appliedConfigDigest: route.configDigest,
      profileId: route.profileId,
      skills: route.skills,
      restrictedMcpTools: route.restrictedMcpTools,
      transformerId: route.transformation.transformerId,
      signatureVerificationConfigured: true,
      secretStoredInHermes: true as const,
      subscriptionState: route.subscription.required ? "active" as const : "not_applicable" as const,
      routeUrl: `https://hooks.example.test/webhooks/${route.routeName}`,
      evidenceRefs: [`hermes-route:${route.routeId}`],
      errors: []
    }))
  };
}

async function createProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "loopgraph-hermes-route-activation-"));
  const loopsDir = path.join(projectRoot, "loops");
  await mkdir(loopsDir, { recursive: true });
  const spec = {
    apiVersion: LOOPGRAPH_API_VERSION,
    kind: LOOP_KIND,
    metadata: { id: "marketing_ads", name: "Ads", version: "1.0.0", description: "Ads loop." },
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
    routine: { steps: [{ id: "observe", name: "Observe", stepType: "observe", actor: "system", description: "Observe." }] },
    tools: [{ key: "draft_review", adapterId: "manual", label: "Draft", writeCapable: false, riskLevel: "low" }],
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
        eventTypePattern: "campaign.performance_anomaly",
        subjectTypes: ["campaign"],
        requiredFields: ["signals.spendDeltaPct"]
      }],
      inputMapping: { subjectId: "subject.id" },
      minimumConfidence: 0.8,
      activationMode: "shadow",
      requiredConnections: []
    }
  };
  const specPath = path.join(loopsDir, "marketing_ads.loopgraph.json");
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  await mkdir(path.join(projectRoot, ".loopgraph"), { recursive: true });
  await writeFile(path.join(projectRoot, ".loopgraph", "workspace.json"), `${JSON.stringify({
    version: 1,
    demoCatalogEnabled: false,
    registeredSpecs: [{
      id: "marketing_ads",
      name: "Ads",
      path: "loops/marketing_ads.loopgraph.json",
      department: "marketing",
      addedAt: "2026-08-23T12:00:00.000Z"
    }]
  }, null, 2)}\n`);
  return projectRoot;
}

async function writeAppInstallationRegistry(
  projectRoot: string,
  installationId: string,
  connectionId: string
): Promise<void> {
  const timestamp = "2026-08-23T12:00:00.000Z";
  const appId = "io.loopgraph.sales";
  const version = "1.0.0";
  const installation = workspaceAppInstallationSchema.parse({
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    id: installationId,
    workspaceId: "acme",
    appId,
    version,
    artifactDigest: canonicalAppDigest("sales-app"),
    state: "ready_to_test",
    mode: "shadow",
    selectedModules: [],
    presetId: "default",
    configuration: {
      schemaVersion: "loopgraph-app-configuration/v1alpha1",
      appId,
      version,
      fields: [],
      values: {},
      provenance: {},
      completedAt: timestamp
    },
    connectionBindings: { "crm.lead.read": connectionId },
    operationBindings: {
      "crm.lead.read": {
        providerId: "hubspot",
        providerOperation: "hubspot.contacts.read",
        operation: "crm.leads.read",
        executor: "connector_broker",
        connectionId,
        brokerCapability: "provider.data.read"
      }
    },
    fieldMappingIds: [],
    permissions: [],
    ownedAssets: [],
    history: [],
    installedAt: timestamp,
    updatedAt: timestamp,
    installedBy: "operator"
  });
  const registry = appInstallationRegistrySchema.parse({
    schemaVersion: APP_INSTALL_SCHEMA_VERSION,
    workspaceId: "acme",
    revision: 1,
    installations: [installation],
    assets: [],
    evaluations: [],
    updatedAt: timestamp
  });
  const appsRoot = path.join(projectRoot, ".loopgraph", "apps");
  await mkdir(appsRoot, { recursive: true });
  await writeFile(path.join(appsRoot, "installations.json"), `${JSON.stringify(registry, null, 2)}\n`);
}
