import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyAppInstallationRegistry,
  type AppInstallationMutationAuditContext,
  type AppInstallationRegistry
} from "loopgraph/runtime";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAppInstallationStore } from "./supabase-app-installation-store";

const scope = {
  organizationId: "123e4567-e89b-12d3-a456-426614174000",
  projectKey: "main",
  workspaceId: "acme"
};
const now = "2026-08-21T14:00:00.000Z";

describe("Supabase App installation store", () => {
  it("rejects unsafe tenant and workspace scopes", () => {
    const client = { rpc: vi.fn(), from: vi.fn() } as unknown as SupabaseClient;
    expect(() => new SupabaseAppInstallationStore(client, { ...scope, organizationId: "../other" })).toThrow(/organization ID/);
    expect(() => new SupabaseAppInstallationStore(client, { ...scope, projectKey: "../../escape" })).toThrow(/project key/);
    expect(() => new SupabaseAppInstallationStore(client, { ...scope, workspaceId: "" })).toThrow(/workspace ID/);
  });

  it("acquires one tenant lease and commits a revision-bound registry", async () => {
    const fake = new InstallationSupabase();
    const store = new SupabaseAppInstallationStore(fake.client, scope);
    expect(await store.read()).toEqual(emptyAppInstallationRegistry(scope.workspaceId));

    const value = await store.withExclusiveUpdate(async (registry) => ({
      registry: {
        ...registry,
        revision: registry.revision + 1,
        updatedAt: now
      },
      value: "committed"
    }));

    expect(value).toBe("committed");
    expect((await store.read()).revision).toBe(1);
    expect(fake.rpc).toHaveBeenCalledWith("acquire_loopgraph_app_installation_lease", expect.objectContaining({
      p_organization_id: scope.organizationId,
      p_workspace_id: scope.workspaceId,
      p_expected_revision: 0
    }));
    expect(fake.rpc).toHaveBeenCalledWith("commit_loopgraph_app_installation_registry", expect.objectContaining({
      p_expected_revision: 0,
      p_registry: expect.objectContaining({ revision: 1 })
    }));
    expect(fake.rpc).not.toHaveBeenCalledWith("release_loopgraph_app_installation_lease", expect.anything());
  });

  it("releases its lease when the shared lifecycle operation fails", async () => {
    const fake = new InstallationSupabase();
    const store = new SupabaseAppInstallationStore(fake.client, scope);
    await expect(store.withExclusiveUpdate(async () => {
      throw new Error("materialization failed");
    })).rejects.toThrow("materialization failed");
    expect(fake.rpc).toHaveBeenCalledWith("release_loopgraph_app_installation_lease", expect.objectContaining({
      p_organization_id: scope.organizationId,
      p_workspace_id: scope.workspaceId
    }));
  });

  it("permits an idempotent no-op without inventing a registry revision", async () => {
    const fake = new InstallationSupabase();
    const store = new SupabaseAppInstallationStore(fake.client, scope);
    const value = await store.withExclusiveUpdate(async (registry) => ({ registry, value: "already-current" }));
    expect(value).toBe("already-current");
    expect((await store.read()).revision).toBe(0);
  });

  it("persists a tenant-scoped onboarding draft through the same revision lease", async () => {
    const fake = new InstallationSupabase();
    const store = new SupabaseAppInstallationStore(fake.client, scope);
    await store.withExclusiveUpdate(async (registry) => ({
      registry: {
        ...registry,
        revision: registry.revision + 1,
        onboardingDrafts: [{
          schemaVersion: "loopgraph-app-onboarding-draft/v1alpha1",
          id: "draft.sales",
          workspaceId: scope.workspaceId,
          companyId: scope.workspaceId,
          appId: "loopgraph.sales.qualify-route-inbound-leads",
          versionRange: "latest",
          presetId: "hubspot-gmail-slack",
          selectedModules: ["lead-qualification"],
          configuration: { exclusions: ["employee"] },
          fieldMappingIds: [],
          revision: 1,
          createdAt: now,
          createdBy: "sales-operations",
          updatedAt: now,
          updatedBy: "sales-operations"
        }],
        updatedAt: now
      },
      audit: {
        actor: "sales-operations",
        action: "app.onboarding_draft.saved",
        targetType: "app_onboarding_draft",
        targetId: "draft.sales",
        metadata: {
          appIdDigest: `sha256:${"a".repeat(64)}`,
          presetIdDigest: `sha256:${"b".repeat(64)}`,
          draftRevision: 1,
          presetChanged: false,
          selectedModuleCount: 1,
          answerCount: 1,
          fieldMappingCount: 0
        }
      },
      value: undefined
    }));

    expect((await store.read()).onboardingDrafts).toEqual([
      expect.objectContaining({ appId: "loopgraph.sales.qualify-route-inbound-leads", revision: 1 })
    ]);
    expect(fake.rpc).toHaveBeenCalledWith("commit_loopgraph_app_installation_registry_with_audit", expect.objectContaining({
      p_registry: expect.objectContaining({ onboardingDrafts: [expect.objectContaining({ updatedBy: "sales-operations" })] }),
      p_audit_context: expect.objectContaining({
        actor: "sales-operations",
        action: "app.onboarding_draft.saved",
        targetId: "draft.sales"
      })
    }));
  });

  it("commits bounded activation authority metadata through the audited registry RPC", async () => {
    const fake = new InstallationSupabase();
    const store = new SupabaseAppInstallationStore(fake.client, scope);
    const approvalId = `activation-approval.${"c".repeat(64)}`;
    await store.withExclusiveUpdate(async (registry) => ({
      registry: {
        ...registry,
        revision: registry.revision + 1,
        updatedAt: now
      },
      audit: {
        actor: "security-approver",
        action: "app.activation.approved",
        targetType: "app_activation_approval",
        targetId: approvalId,
        metadata: {
          installationIdDigest: `sha256:${"d".repeat(64)}`,
          appIdDigest: `sha256:${"e".repeat(64)}`,
          artifactDigest: `sha256:${"f".repeat(64)}`,
          approvalDigest: `sha256:${"0".repeat(64)}`,
          fromState: "simulation_passed",
          requestedMode: "shadow",
          evidenceRefCount: 1,
          expiresAt: "2026-08-21T14:15:00.000Z"
        }
      },
      value: approvalId
    }));

    expect(fake.rpc).toHaveBeenCalledWith("commit_loopgraph_app_installation_registry_with_audit", expect.objectContaining({
      p_expected_revision: 0,
      p_registry: expect.objectContaining({ revision: 1 }),
      p_audit_context: {
        actor: "security-approver",
        action: "app.activation.approved",
        targetType: "app_activation_approval",
        targetId: approvalId,
        metadata: expect.objectContaining({
          installationIdDigest: `sha256:${"d".repeat(64)}`,
          approvalDigest: `sha256:${"0".repeat(64)}`,
          evidenceRefCount: 1
        })
      }
    }));
  });

  it("rejects review content in an activation audit envelope before commit", async () => {
    const fake = new InstallationSupabase();
    const store = new SupabaseAppInstallationStore(fake.client, scope);
    const unsafeAudit = {
      actor: "security-approver",
      action: "app.activation.approved",
      targetType: "app_activation_approval",
      targetId: `activation-approval.${"c".repeat(64)}`,
      metadata: {
        installationIdDigest: `sha256:${"d".repeat(64)}`,
        appIdDigest: `sha256:${"e".repeat(64)}`,
        artifactDigest: `sha256:${"f".repeat(64)}`,
        approvalDigest: `sha256:${"0".repeat(64)}`,
        fromState: "simulation_passed",
        requestedMode: "shadow",
        evidenceRefCount: 1,
        expiresAt: "2026-08-21T14:15:00.000Z",
        reason: "Do not copy review text into the audit chain."
      }
    } as unknown as AppInstallationMutationAuditContext;

    await expect(store.withExclusiveUpdate(async (registry) => ({
      registry: { ...registry, revision: registry.revision + 1, updatedAt: now },
      audit: unsafeAudit,
      value: undefined
    }))).rejects.toThrow();
    expect(fake.rpc).not.toHaveBeenCalledWith("commit_loopgraph_app_installation_registry_with_audit", expect.anything());
    expect(fake.rpc).toHaveBeenCalledWith("release_loopgraph_app_installation_lease", expect.objectContaining({
      p_workspace_id: scope.workspaceId
    }));
  });
});

class InstallationSupabase {
  row: { registry_payload: AppInstallationRegistry; lock_payload: unknown | null } | undefined;
  leaseToken: string | undefined;
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "acquire_loopgraph_app_installation_lease") {
      this.row ??= { registry_payload: emptyAppInstallationRegistry(scope.workspaceId), lock_payload: null };
      if (this.row.registry_payload.revision !== args.p_expected_revision) {
        return { data: null, error: { message: "revision conflict" } };
      }
      this.leaseToken = String(args.p_lease_token);
      return { data: this.row, error: null };
    }
    if (name === "commit_loopgraph_app_installation_registry" || name === "commit_loopgraph_app_installation_registry_with_audit") {
      if (this.leaseToken !== args.p_lease_token) return { data: null, error: { message: "lease conflict" } };
      this.row = {
        registry_payload: args.p_registry as AppInstallationRegistry,
        lock_payload: args.p_lock ?? null
      };
      this.leaseToken = undefined;
      return { data: this.row.registry_payload, error: null };
    }
    if (name === "release_loopgraph_app_installation_lease") {
      if (this.leaseToken === args.p_lease_token) this.leaseToken = undefined;
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unknown RPC ${name}` } };
  });

  client = {
    rpc: this.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: this.row, error: null })
      };
      return query;
    }
  } as unknown as SupabaseClient;
}
