import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  contentHash,
  hermesRouteActivationRecordSchema,
  type HermesRouteActivationRecord
} from "loopgraph/core";
import { SupabaseHermesRouteActivationStore } from "./supabase-hermes-route-activation-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme"
};

describe("Supabase Hermes route activation store", () => {
  it("rejects unsafe tenant and workspace scopes", () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseHermesRouteActivationStore(client, { ...scope, organizationId: "../other" })).toThrow(/organization ID/);
    expect(() => new SupabaseHermesRouteActivationStore(client, { ...scope, projectKey: "../../escape" })).toThrow(/project key/);
    expect(() => new SupabaseHermesRouteActivationStore(client, { ...scope, workspaceId: "" })).toThrow(/workspace ID/);
  });

  it("writes and reads only validated scope-bound activation records", async () => {
    const fake = new RouteActivationSupabase();
    const store = new SupabaseHermesRouteActivationStore(fake.client, scope);
    const first = activationRecord("2026-08-23T12:00:00.000Z", "controller-a");
    const second = activationRecord("2026-08-23T12:05:00.000Z", "controller-b");

    expect(await store.read()).toBeNull();
    await store.write(first);
    await store.write(second);

    expect(await store.read()).toEqual(second);
    expect(fake.rpc).toHaveBeenLastCalledWith("record_loopgraph_hermes_route_activation", {
      p_organization_id: scope.organizationId,
      p_project_key: scope.projectKey,
      p_workspace_id: scope.workspaceId,
      p_record: second
    });
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toMatch(/access_token|client_secret|webhook_secret/);
  });

  it("fails before persistence when a record digest or secret boundary is changed", async () => {
    const fake = new RouteActivationSupabase();
    const store = new SupabaseHermesRouteActivationStore(fake.client, scope);
    const changedDigest = structuredClone(activationRecord("2026-08-23T12:00:00.000Z", "controller-a"));
    changedDigest.plan.routes[0]!.routeName = "changed-after-digest";
    await expect(store.write(changedDigest)).rejects.toThrow(/content digest/);

    const secret = structuredClone(activationRecord("2026-08-23T12:00:00.000Z", "controller-a")) as unknown as Record<string, unknown>;
    secret.access_token = "should-never-persist";
    await expect(store.write(secret as unknown as HermesRouteActivationRecord)).rejects.toThrow();
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

class RouteActivationSupabase {
  records: HermesRouteActivationRecord[] = [];
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== "record_loopgraph_hermes_route_activation") {
      return { data: null, error: { message: "unexpected RPC" } };
    }
    const record = args.p_record as HermesRouteActivationRecord;
    const existing = this.records.find((candidate) => candidate.requestDigest === record.requestDigest);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      return { data: null, error: { message: "immutable Hermes route activation conflict" } };
    }
    if (!existing) this.records.push(record);
    return { data: existing ?? record, error: null };
  });

  client = {
    rpc: this.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({
          data: this.records.length > 0
            ? { record_payload: [...this.records].sort((left, right) => right.activatedAt.localeCompare(left.activatedAt))[0] }
            : null,
          error: null
        })
      };
      return query;
    }
  } as unknown as SupabaseClient;
}

function activationRecord(activatedAt: string, controllerInstanceId: string): HermesRouteActivationRecord {
  const routeIdentity = {
    routeId: "hermes_route_lifecycle",
    routeName: "loopgraph-lifecycle-events",
    routeKind: "loopgraph_lifecycle" as const,
    sourcePattern: "loopgraph",
    eventTypePatterns: ["loop.run.completed"],
    subjectTypes: ["loop"],
    loopIds: [],
    requiredCapabilities: [],
    profileId: "loopgraph_lifecycle_router" as const,
    skills: ["loopgraph-event-router"],
    restrictedMcpTools: ["loopgraph_events_ingest"],
    deliveryMode: "log" as const,
    activationMode: "shadow" as const,
    authentication: {
      owner: "hermes" as const,
      signatureVerificationRequired: true as const,
      secretStoredInLoopgraph: false as const
    },
    transformation: {
      transformerId: "loopgraph-lifecycle-event-envelope/v1alpha1",
      outputSchema: "EventEnvelope" as const,
      dropsRawPayload: true as const,
      stableDeliveryIdRequired: true as const
    },
    subscription: {
      owner: "hermes" as const,
      policy: "notification_only" as const,
      connectionIds: [],
      required: false
    },
    filters: ["Allow signed Loopgraph lifecycle callbacks only."]
  };
  const route = { ...routeIdentity, configDigest: contentHash(routeIdentity) };
  const planIdentity = {
    projectRootHash: contentHash("project"),
    catalogVersion: "catalog-v1",
    manifestDigest: contentHash("manifest"),
    controllerProtocol: "hermes-route-controller-request/v1alpha1" as const,
    destructiveChangesAllowed: false as const,
    routes: [route]
  };
  const plan = {
    schemaVersion: "hermes-route-activation-plan/v1alpha1" as const,
    ...planIdentity,
    planDigest: contentHash(planIdentity),
    generatedAt: activatedAt,
    warnings: [],
    nextActions: ["Keep the route in shadow mode."]
  };
  return hermesRouteActivationRecordSchema.parse({
    schemaVersion: "hermes-route-activation-record/v1alpha1",
    activatedAt,
    controllerOrigin: "https://hermes.example.test",
    ready: true,
    requestDigest: contentHash({ activatedAt, controllerInstanceId }),
    plan,
    receipt: {
      schemaVersion: "hermes-route-controller-receipt/v1alpha1",
      requestId: `request-${contentHash(activatedAt)}`,
      controllerInstanceId,
      appliedAt: activatedAt,
      projectRootHash: plan.projectRootHash,
      catalogVersion: plan.catalogVersion,
      manifestDigest: plan.manifestDigest,
      planDigest: plan.planDigest,
      destructiveChangesApplied: false,
      routes: [{
        routeId: route.routeId,
        routeName: route.routeName,
        state: "shadow",
        appliedConfigDigest: route.configDigest,
        profileId: route.profileId,
        skills: route.skills,
        restrictedMcpTools: route.restrictedMcpTools,
        transformerId: route.transformation.transformerId,
        signatureVerificationConfigured: true,
        secretStoredInHermes: true,
        subscriptionState: "not_applicable",
        evidenceRefs: ["controller:test"],
        errors: []
      }]
    }
  });
}
