import { describe, expect, it } from "vitest";
import {
  canRoleMutateHostedApi,
  isMachineAuthenticatedRoute,
  isSameOriginRequest,
  isUnsafeMethod,
  isViewerSafeHostedMutation,
  selectHostedMembership
} from "./middleware-policy";

describe("hosted middleware policy", () => {
  it("leaves independently authenticated machine endpoints to their route guards", () => {
    expect(isMachineAuthenticatedRoute("/api/auth/device/code")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/auth/device/token")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/auth/device/refresh")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/auth/device/revoke")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/auth/device/approve")).toBe(false);
    expect(isMachineAuthenticatedRoute("/api/cron/controller")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/webhooks/github")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/graph/transactions")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/connector-broker/v1/invocations")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/connector-broker/v1/oauth/callback")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/operations/metrics")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-tasks/task_1/callback")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-dispatch/worker")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-callbacks/worker")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/agents")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/agents/agent_1/heartbeat")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/executions/events")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/marketplace/verifier/worker")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/marketplace/client/catalog")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/marketplace/client/artifacts")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/operations/audit-export")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/routing/worker")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/routing/jobs/job_1")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-tasks")).toBe(false);
    expect(isMachineAuthenticatedRoute("/api/hermes/agents/agent_1")).toBe(false);
    expect(isMachineAuthenticatedRoute("/api/marketplace/apps")).toBe(false);
    expect(isMachineAuthenticatedRoute("/api/audit/export")).toBe(false);
    expect(isMachineAuthenticatedRoute("/api/opportunities")).toBe(false);
  });

  it("requires same-origin browser writes", () => {
    expect(isUnsafeMethod("POST")).toBe(true);
    expect(isUnsafeMethod("GET")).toBe(false);
    expect(isSameOriginRequest(
      "https://app.example.com/api/opportunities",
      "https://app.example.com"
    )).toBe(true);
    expect(isSameOriginRequest(
      "https://app.example.com/api/opportunities",
      "https://attacker.example"
    )).toBe(false);
    expect(isSameOriginRequest("https://app.example.com/api/opportunities", null)).toBe(false);
  });

  it("keeps viewers read-only at the API boundary", () => {
    expect(canRoleMutateHostedApi("viewer")).toBe(false);
    expect(canRoleMutateHostedApi("operator")).toBe(true);
    expect(canRoleMutateHostedApi("admin")).toBe(true);
    expect(canRoleMutateHostedApi("owner")).toBe(true);
    expect(canRoleMutateHostedApi("unknown")).toBe(false);
    expect(isViewerSafeHostedMutation("/api/auth/device/approve")).toBe(true);
    expect(isViewerSafeHostedMutation("/api/marketplace/releases")).toBe(false);
  });

  it("authorizes against the selected organization instead of the first membership", () => {
    const memberships = [
      { organization_id: "org_viewer", role: "viewer" },
      { organization_id: "org_owner", role: "owner" }
    ];
    expect(selectHostedMembership(memberships, "org_owner")?.role).toBe("owner");
    expect(selectHostedMembership(memberships, "unknown")?.role).toBe("viewer");
    expect(selectHostedMembership(memberships, "unknown", true)).toBeUndefined();
  });
});
