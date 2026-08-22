import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_LIFECYCLE_OPERATION_LIMIT, appLifecycleOperationSchema } from "loopgraph/runtime";
import { AppLifecycleRecoveryNotice } from "./app-lifecycle-recovery";

describe("AppLifecycleRecoveryNotice", () => {
  it("explains the exact safe retry without rendering completed work or secret fields", () => {
    expect(APP_LIFECYCLE_OPERATION_LIMIT).toBe(100);
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.1234567890abcdef",
      idempotencyKey: "1234567890abcdef",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "install",
      targetArtifactDigest: "abcdef1234567890",
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: ["mapping.lead"], companyContextKeys: ["sales.icp"] },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const completed = appLifecycleOperationSchema.parse({
      ...operation,
      id: "lifecycle.completed123",
      status: "completed",
      completedAt: "2026-08-21T10:02:00.000Z",
      failureCode: undefined
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation, completed] }));
    expect(html).toContain("One App operation needs to finish");
    expect(html).toContain("retry that exact plan");
    expect(html).toContain("requires reconciliation");
    expect(html).not.toContain("lifecycle.completed123");
    expect(html).not.toMatch(/token|credential|provider payload/i);
  });

  it("directs an interrupted activation to its exact existing authority", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.activate123",
      idempotencyKey: "activate123456789",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "activate",
      targetArtifactDigest: "abcdef1234567890",
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: [], companyContextKeys: [] },
      activation: {
        approvalReceiptId: "activation-approval.1234567890abcdef",
        approvalDigest: `sha256:${"a".repeat(64)}`,
        fromState: "shadow",
        targetMode: "recommend"
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("recorded recommend transition");
    expect(html).toContain("consume that authority once");
    expect(html).not.toContain(operation.activation?.approvalReceiptId ?? "missing");
  });

  it("explains an interrupted rollout without broadening the requested transition", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.pause123",
      idempotencyKey: "pause123456789012",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "pause",
      targetArtifactDigest: "abcdef1234567890",
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: [], companyContextKeys: [] },
      rollout: {
        fromState: "recommend",
        fromMode: "recommend",
        fromUpdatedAt: "2026-08-21T09:59:00.000Z",
        targetState: "paused",
        targetMode: "recommend"
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("recorded pause transition to paused");
    expect(html).toContain("exact owned LoopSpec inventory");
    expect(html).not.toMatch(/token|credential|provider payload/i);
  });

  it("shows the content-bound uninstall identity without storing the raw reason", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.uninstall123",
      idempotencyKey: "uninstall12345678",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "uninstall",
      targetArtifactDigest: `sha256:${"a".repeat(64)}`,
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: ["mapping.lead"], companyContextKeys: ["sales.icp"] },
      uninstall: {
        fromUpdatedAt: "2026-08-21T09:59:00.000Z",
        sourceInstallationDigest: `sha256:${"b".repeat(64)}`,
        sourceOwnershipDigest: `sha256:${"c".repeat(64)}`,
        reasonDigest: `sha256:${"d".repeat(64)}`,
        sourceWorkspaceRevision: 9,
        sourceLoopInventoryDigest: `sha256:${"e".repeat(64)}`,
        remainingLoopInventoryDigest: `sha256:${"f".repeat(64)}`,
        remainingLoopIds: []
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("same actor with the exact original reason");
    expect(html).toContain(operation.uninstall?.reasonDigest ?? "missing");
    expect(html).not.toContain("Remove the customer account");
    expect(html).not.toMatch(/token|credential|provider payload/i);
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      uninstall: { ...operation.uninstall!, remainingLoopIds: ["another-installation-loop"] }
    })).toThrow(/subset of the recorded source inventory/);
  });
});
