import { describe, expect, it } from "vitest";
import { connectorInstallationViewSchema } from "../core";
import {
  DEFAULT_CONNECTOR_MANIFESTS,
  connectionInstanceFromBrokerInstallation,
  mergeConnectionInstances
} from "./connector-registry";
import { PROVIDER_ONBOARDING_CATALOG } from "./provider-onboarding";

function installation(overrides: Record<string, unknown> = {}) {
  return connectorInstallationViewSchema.parse({
    id: "provider_hubspot_main",
    tenant: { organizationId: "org-acme", projectKey: "main" },
    providerId: "hubspot",
    displayName: "Acme HubSpot",
    environment: "production",
    status: "active",
    grantedScopes: ["crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read"],
    allowedCapabilities: [
      "provider.health.read",
      "provider.data.read",
      "provider.webhooks.subscribe",
      "provider.webhooks.verify",
      "provider.disconnect"
    ],
    webhookStatus: "active",
    connectedBy: "admin-acme",
    connectedAt: "2026-08-10T10:00:00.000Z",
    lastHealthCheckAt: "2026-08-10T10:05:00.000Z",
    createdAt: "2026-08-10T09:55:00.000Z",
    updatedAt: "2026-08-10T10:05:00.000Z",
    customerManagedKeyConfigured: true,
    ...overrides
  });
}

describe("Hermes Connector Broker App Platform projection", () => {
  it("projects only non-secret readiness metadata into a reusable app connection", () => {
    const connection = connectionInstanceFromBrokerInstallation(installation());
    expect(connection).toMatchObject({
      id: "provider_hubspot_main",
      manifestId: "hubspot",
      source: "hermes_connector_broker",
      externalInstallationId: "provider_hubspot_main",
      status: "connected",
      environment: "live",
      readPolicy: "read_only",
      writePolicy: "not_allowed",
      capabilityKeys: expect.arrayContaining(["crm.read", "crm.events"]),
      health: { status: "connected", checkedBy: "hermes_connector_broker" }
    });
    expect(connection).not.toHaveProperty("credentialRef");
  });

  it("does not convert a pending or revoked broker record into active authority", () => {
    expect(connectionInstanceFromBrokerInstallation(installation({ status: "subscription_pending" }))).toMatchObject({
      status: "degraded"
    });
    expect(connectionInstanceFromBrokerInstallation(installation({ status: "revoked", allowedCapabilities: [] }))).toMatchObject({
      status: "missing",
      capabilityKeys: [],
      readPolicy: "not_allowed",
      writePolicy: "not_allowed"
    });
  });

  it("has an App Platform manifest for every broker onboarding provider", () => {
    const manifestIds = new Set(DEFAULT_CONNECTOR_MANIFESTS.map((manifest) => manifest.id));
    expect(PROVIDER_ONBOARDING_CATALOG.every((provider) => manifestIds.has(provider.providerId))).toBe(true);
  });

  it("lets the broker projection replace stale local metadata with the same stable ID", () => {
    const broker = connectionInstanceFromBrokerInstallation(installation());
    const merged = mergeConnectionInstances([{
      ...broker,
      source: "local_registry",
      status: "degraded",
      statusReason: "stale local health"
    }], [broker]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "hermes_connector_broker", status: "connected" });
  });
});
