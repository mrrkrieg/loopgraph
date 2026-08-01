import { describe, expect, it } from "vitest";
import {
  canRoleMutateHostedApi,
  isMachineAuthenticatedRoute,
  isSameOriginRequest,
  isUnsafeMethod,
  selectHostedMembership
} from "./middleware-policy";

describe("hosted middleware policy", () => {
  it("leaves independently authenticated machine endpoints to their route guards", () => {
    expect(isMachineAuthenticatedRoute("/api/cron/controller")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/webhooks/github")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/graph/transactions")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/connector-broker/v1/invocations")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/connector-broker/v1/oauth/callback")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/operations/metrics")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-tasks/task_1/callback")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-dispatch/worker")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-callbacks/worker")).toBe(true);
    expect(isMachineAuthenticatedRoute("/api/hermes/design-tasks")).toBe(false);
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
