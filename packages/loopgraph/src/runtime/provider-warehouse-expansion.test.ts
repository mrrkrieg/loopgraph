import { describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_BROKER_PROTOCOL_VERSION,
  buildCredentialNamespace,
  connectorBrokerRequestSchema,
  connectorInstallationAdminSchema,
  type ProviderId
} from "../core";
import { getProviderOperation } from "./connector-capabilities";
import { defaultConnectorManifests } from "./connector-registry";
import { getProviderOnboardingProfile } from "./provider-onboarding";
import { createProviderOperationHandlers } from "./provider-operation-handlers";
import { SecretLease } from "./vault-adapters";

describe("warehouse provider expansion", () => {
  it("registers read-only scheduled-detector contracts for both warehouse providers", () => {
    expect(getProviderOnboardingProfile("bigquery")).toMatchObject({
      systemClass: "data_warehouse",
      authorization: { mode: "admin_managed", credentialKind: "service_account" },
      ingestion: { mode: "scheduled_detector", pollCadenceMinutes: 60 }
    });
    expect(getProviderOnboardingProfile("snowflake")).toMatchObject({
      systemClass: "data_warehouse",
      authorization: { mode: "admin_managed", credentialKind: "connected_app" },
      ingestion: { mode: "scheduled_detector", pollCadenceMinutes: 60 }
    });
    for (const providerId of ["bigquery", "snowflake"] as const) {
      const manifest = defaultConnectorManifests().find((candidate) => candidate.id === providerId);
      expect(manifest?.capabilities.map((capability) => capability.key)).toEqual(expect.arrayContaining([
        "analytics.metric.query", "finance.forecast.read", "capacity.plan.read", "warehouse.events"
      ]));
      expect(getProviderOperation(providerId, "company-metrics.query")).toMatchObject({ capability: "provider.data.read", write: false, approvalRequired: false });
      expect(getProviderOperation(providerId, "company-metrics.detect")).toMatchObject({ capability: "provider.events.emit", write: false, approvalRequired: false });
    }
  });

  it("executes only the configured BigQuery template with bounded named parameters", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        jobComplete: true,
        totalRows: "1",
        totalBytesProcessed: "1024",
        schema: { fields: [{ name: "metric_id", type: "STRING" }] },
        rows: [{ f: [{ v: "qualified-pipeline" }] }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("bigquery:company-metrics.query")!;
    const secret = JSON.stringify({
      access_token: "bigquery-workload-token",
      project_id: "loopgraph-demo",
      maximum_bytes_billed: "1000000",
      query_templates: {
        "company-metrics.query": {
          statement: "SELECT metric_id, current_value FROM `approved.company_metrics` WHERE observed_at >= @window_start AND observed_at < @window_end LIMIT @limit"
        }
      }
    });
    const input = { windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-08T00:00:00.000Z", limit: 25 };

    await expect(handler(context("bigquery", "company-metrics.query", { ...input, sql: "SELECT * FROM private.secrets" }, secret))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(handler(context("bigquery", "company-metrics.query", input, secret))).resolves.toMatchObject({
      providerObjectRef: "bigquery:project:loopgraph-demo:template:company-metrics.query",
      templateId: "company-metrics.query",
      totalRows: "1"
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://bigquery.googleapis.com/bigquery/v2/projects/loopgraph-demo/queries");
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ useLegacySql: false, maximumBytesBilled: "1000000", maxResults: 25 });
    expect(String(request.query)).toContain("approved.company_metrics");
    expect(JSON.stringify(request.queryParameters)).not.toContain("private.secrets");
  });

  it("maps detector operations to the same credential-owned fixed query templates", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      jobComplete: true,
      schema: { fields: [{ name: "material", type: "BOOLEAN" }] },
      rows: [{ f: [{ v: "false" }] }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("bigquery:company-metrics.detect")!;
    const secret = JSON.stringify({
      access_token: "workload-token",
      project_id: "loopgraph-demo",
      maximum_bytes_billed: "1000000",
      query_templates: {
        "company-metrics.query": {
          statement: "SELECT false AS material WHERE @window_start < @window_end LIMIT @limit"
        }
      }
    });
    await expect(handler(context("bigquery", "company-metrics.detect", {
      windowStart: "2026-08-01T00:00:00.000Z",
      windowEnd: "2026-08-01T01:00:00.000Z",
      limit: 100
    }, secret))).resolves.toMatchObject({ templateId: "company-metrics.query" });
  });

  it("rejects mutation or unbounded BigQuery templates before any provider request", async () => {
    const fetcher = vi.fn();
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("bigquery:finance-forecast.query")!;
    const base = { access_token: "token", project_id: "loopgraph-demo", maximum_bytes_billed: "1000000" };
    const input = { windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-08T00:00:00.000Z" };

    await expect(handler(context("bigquery", "finance-forecast.query", input, JSON.stringify({ ...base, query_templates: { "finance-forecast.query": { statement: "DELETE FROM approved.forecasts WHERE observed_at < @window_end" } } })))).rejects.toMatchObject({ code: "provider_query_template_invalid" });
    await expect(handler(context("bigquery", "finance-forecast.query", input, JSON.stringify({ ...base, query_templates: { "finance-forecast.query": { statement: "SELECT * FROM approved.forecasts" } } })))).rejects.toMatchObject({ code: "provider_query_template_invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("pins Snowflake to the credential-owned account and binding order", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        statementHandle: "handle-1",
        resultSetMetaData: { numRows: 1, format: "jsonv2", rowType: [{ name: "METRIC_ID", type: "text" }] },
        data: [["qualified-pipeline"]]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("snowflake:company-metrics.query")!;
    const secret = JSON.stringify({
      access_token: "snowflake-oauth-token",
      instance_url: "https://acme-prod.snowflakecomputing.com",
      token_type: "OAUTH",
      database: "LOOPGRAPH",
      schema: "APPROVED",
      warehouse: "LOOPGRAPH_READ",
      role: "LOOPGRAPH_READER",
      query_templates: {
        "company-metrics.query": {
          statement: "WITH bounded AS (SELECT METRIC_ID FROM COMPANY_METRICS WHERE OBSERVED_AT >= ? AND OBSERVED_AT < ?) SELECT * FROM bounded LIMIT ?",
          binding_order: ["windowStart", "windowEnd", "limit"]
        }
      }
    });
    const input = { windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-08T00:00:00.000Z", limit: 25 };

    await expect(handler(context("snowflake", "company-metrics.query", { ...input, url: "https://attacker.example", sql: "SELECT CURRENT_USER()" }, secret))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(handler(context("snowflake", "company-metrics.query", input, secret))).resolves.toMatchObject({ templateId: "company-metrics.query", statementHandle: "handle-1" });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://acme-prod.snowflakecomputing.com");
    expect(url.pathname).toBe("/api/v2/statements");
    expect(url.searchParams.get("requestId")).toMatch(/^[a-f0-9-]{36}$/);
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ database: "LOOPGRAPH", schema: "APPROVED", warehouse: "LOOPGRAPH_READ", role: "LOOPGRAPH_READER" });
    expect(request.bindings).toEqual({
      "1": { type: "TEXT", value: input.windowStart },
      "2": { type: "TEXT", value: input.windowEnd },
      "3": { type: "FIXED", value: "25" }
    });
  });

  it("rejects an untrusted Snowflake host before making a request", async () => {
    const fetcher = vi.fn();
    const handler = createProviderOperationHandlers(fetcher as typeof fetch).get("snowflake:capacity-plan.query")!;
    const secret = JSON.stringify({
      access_token: "token",
      instance_url: "https://attacker.example",
      database: "LOOPGRAPH",
      schema: "APPROVED",
      warehouse: "LOOPGRAPH_READ",
      role: "LOOPGRAPH_READER",
      query_templates: {
        "capacity-plan.query": {
          statement: "SELECT PLAN_ID FROM CAPACITY_PLANS WHERE OBSERVED_AT >= ? AND OBSERVED_AT < ?",
          binding_order: ["windowStart", "windowEnd"]
        }
      }
    });
    await expect(handler(context("snowflake", "capacity-plan.query", { windowStart: "2026-08-01T00:00:00.000Z", windowEnd: "2026-08-08T00:00:00.000Z" }, secret))).rejects.toMatchObject({ code: "provider_instance_untrusted" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function context(providerId: ProviderId, operation: string, input: Record<string, unknown>, secret: string) {
  const namespace = buildCredentialNamespace({ organizationId: "org-1", projectKey: "main", providerId, installationId: `${providerId}-1` });
  const installation = connectorInstallationAdminSchema.parse({
    id: `${providerId}-1`,
    tenant: { organizationId: "org-1", projectKey: "main" },
    providerId,
    displayName: providerId,
    environment: "production",
    status: "active",
    credentialRef: `vault://${namespace}/tokens/provider`,
    credentialNamespace: namespace,
    grantedScopes: [],
    allowedCapabilities: ["provider.data.read"],
    webhookStatus: "not_configured",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  });
  const descriptor = getProviderOperation(providerId, operation);
  if (!descriptor) throw new Error(`Missing descriptor: ${providerId}:${operation}`);
  return {
    request: connectorBrokerRequestSchema.parse({
      protocolVersion: CONNECTOR_BROKER_PROTOCOL_VERSION,
      requestId: "request-warehouse-provider",
      idempotencyKey: "idempotency-warehouse-provider",
      tenant: installation.tenant,
      actor: { type: "workload", subject: "hermes" },
      providerId,
      installationId: installation.id,
      capability: descriptor.capability,
      operation,
      input,
      issuedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T00:05:00.000Z",
      correlationId: "correlation-warehouse-provider"
    }),
    installation,
    descriptor,
    getCredential: async () => new SecretLease({ value: secret })
  };
}
