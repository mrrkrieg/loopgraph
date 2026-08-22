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

  it("explains exact rollback recovery and exposes only bounded source and target identity", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.rollback123",
      idempotencyKey: "rollback12345678",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "rollback",
      targetArtifactDigest: `sha256:${"a".repeat(64)}`,
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: ["mapping.lead"], companyContextKeys: ["sales.icp"] },
      rollback: {
        fromUpdatedAt: "2026-08-21T09:59:00.000Z",
        sourceArtifactDigest: `sha256:${"b".repeat(64)}`,
        sourceInstallationDigest: `sha256:${"c".repeat(64)}`,
        sourceOwnershipDigest: `sha256:${"d".repeat(64)}`,
        sourceWorkspaceRevision: 9,
        sourceLoopInventoryDigest: `sha256:${"e".repeat(64)}`,
        sourceLoopIds: ["sales.qualify"],
        targetInstallationDigest: `sha256:${"f".repeat(64)}`,
        targetOwnershipDigest: `sha256:${"1".repeat(64)}`,
        targetLoopInventoryDigest: `sha256:${"2".repeat(64)}`,
        targetLoopIds: ["sales.qualify"]
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("same actor");
    expect(html).toContain("exact source or target LoopSpec topology");
    expect(html).toContain(operation.rollback?.sourceArtifactDigest ?? "missing");
    expect(html).toContain(operation.targetArtifactDigest);
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      rollback: { ...operation.rollback!, targetLoopIds: ["different-loop"] }
    })).toThrow(/must match the desired inventory/);
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      status: "completed",
      failureCode: undefined,
      completedAt: "2026-08-21T10:02:00.000Z"
    })).toThrow(/require their exact lifecycle receipt/);
  });

  it("explains exact update recovery without persisting the reviewed plan body", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.update123",
      idempotencyKey: "update1234567890",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "update",
      targetArtifactDigest: `sha256:${"a".repeat(64)}`,
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: ["mapping.lead"], companyContextKeys: ["sales.icp"] },
      update: {
        fromUpdatedAt: "2026-08-21T09:59:00.000Z",
        sourceArtifactDigest: `sha256:${"b".repeat(64)}`,
        sourceInstallationDigest: `sha256:${"c".repeat(64)}`,
        sourceOwnershipDigest: `sha256:${"d".repeat(64)}`,
        sourceWorkspaceRevision: 9,
        sourceLoopInventoryDigest: `sha256:${"e".repeat(64)}`,
        sourceLoopIds: ["sales.qualify"],
        planDigest: `sha256:${"f".repeat(64)}`,
        approvedPermissionCapabilities: ["crm.lead.update"],
        targetInstallationDigest: `sha256:${"1".repeat(64)}`,
        targetOwnershipDigest: `sha256:${"2".repeat(64)}`,
        targetLoopInventoryDigest: `sha256:${"3".repeat(64)}`,
        targetLoopIds: ["sales.qualify"]
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("same actor");
    expect(html).toContain("recorded permission approvals");
    expect(html).toContain("original approval window expires");
    expect(html).toContain(operation.update?.planDigest ?? "missing");
    expect(html).toContain(operation.update?.sourceArtifactDigest ?? "missing");
    expect(html).not.toContain("configuration");
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      update: { ...operation.update!, targetLoopIds: ["different-loop"] }
    })).toThrow(/must be unique and match the desired inventory/);
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      status: "completed",
      failureCode: undefined,
      completedAt: "2026-08-21T10:02:00.000Z"
    })).toThrow(/require their exact lifecycle receipt/);
  });

  it("explains exact configure recovery without rendering confirmed values", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.configure123",
      idempotencyKey: "configure12345678",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "configure",
      targetArtifactDigest: `sha256:${"a".repeat(64)}`,
      status: "requires_reconciliation",
      desired: { loopIds: [], fieldMappingIds: [], companyContextKeys: [] },
      configure: {
        fromUpdatedAt: "2026-08-21T09:59:00.000Z",
        sourceConfigurationDigest: `sha256:${"b".repeat(64)}`,
        sourceInstallationDigest: `sha256:${"c".repeat(64)}`,
        valuesDigest: `sha256:${"d".repeat(64)}`,
        targetConfigurationDigest: `sha256:${"e".repeat(64)}`,
        targetInstallationDigest: `sha256:${"f".repeat(64)}`
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("same actor");
    expect(html).toContain("stores only their digest");
    expect(html).toContain(operation.configure?.valuesDigest ?? "missing");
    expect(html).toContain(operation.configure?.sourceConfigurationDigest ?? "missing");
    expect(html).not.toContain("followUpSlaMinutes");
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: [], companyContextKeys: [] }
    })).toThrow(/may change only the installation configuration/);
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      status: "completed",
      failureCode: undefined,
      completedAt: "2026-08-21T10:02:00.000Z"
    })).toThrow(/require their exact lifecycle receipt/);
  });

  it("explains exact overlay recovery without rendering the customization body", () => {
    const operation = appLifecycleOperationSchema.parse({
      id: "lifecycle.overlay123",
      idempotencyKey: "overlay1234567890",
      installationId: "install.acme.sales",
      appId: "loopgraph.sales.qualify-route-inbound-leads",
      action: "overlay",
      targetArtifactDigest: `sha256:${"a".repeat(64)}`,
      status: "requires_reconciliation",
      desired: { loopIds: ["sales.qualify"], fieldMappingIds: [], companyContextKeys: [] },
      overlay: {
        fromUpdatedAt: "2026-08-21T09:59:00.000Z",
        sourceArtifactDigest: `sha256:${"a".repeat(64)}`,
        sourceInstallationDigest: `sha256:${"b".repeat(64)}`,
        sourceOwnershipDigest: `sha256:${"c".repeat(64)}`,
        sourceWorkspaceRevision: 9,
        sourceLoopInventoryDigest: `sha256:${"d".repeat(64)}`,
        sourceLoopIds: ["sales.qualify", "sales.follow-up"],
        expectedOverlayRevision: 0,
        operationsDigest: `sha256:${"e".repeat(64)}`,
        targetInstallationDigest: `sha256:${"f".repeat(64)}`,
        targetOwnershipDigest: `sha256:${"1".repeat(64)}`,
        targetLoopInventoryDigest: `sha256:${"2".repeat(64)}`,
        targetLoopIds: ["sales.qualify"]
      },
      actor: "admin-1",
      startedAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:01:00.000Z",
      failureCode: "operation_interrupted"
    });
    const html = renderToStaticMarkup(React.createElement(AppLifecycleRecoveryNotice, { operations: [operation] }));
    expect(html).toContain("same actor");
    expect(html).toContain("source or target owned LoopSpec topology");
    expect(html).toContain(operation.overlay?.operationsDigest ?? "missing");
    expect(html).toContain("Source overlay revision");
    expect(html).not.toContain("qualificationThreshold");
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      desired: { loopIds: ["different-loop"], fieldMappingIds: [], companyContextKeys: [] }
    })).toThrow(/must be unique and match the desired inventory/);
    expect(() => appLifecycleOperationSchema.parse({
      ...operation,
      status: "completed",
      failureCode: undefined,
      completedAt: "2026-08-21T10:02:00.000Z"
    })).toThrow(/require their exact lifecycle receipt/);
  });
});
