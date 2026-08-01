import {
  connectorActionPrepareResponseSchema,
  connectorBrokerResponseSchema,
  type ConnectorActionCommitRequest,
  type ConnectorActionPrepareRequest,
  type ConnectorActionPrepareResponse,
  type ConnectorBrokerRequest,
  type ConnectorBrokerResponse
} from "../core";
import { redactSensitiveString } from "./secret-redaction";
import type { WorkloadTokenProvider } from "./workload-token-provider";

export class ConnectorBrokerClient {
  private readonly baseUrl: URL;

  constructor(private readonly options: {
    baseUrl: string;
    audience: string;
    tokenProvider: WorkloadTokenProvider;
    fetcher?: typeof fetch;
  }) {
    this.baseUrl = new URL(options.baseUrl);
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) {
      throw new Error("Connector broker URL must not contain credentials, query, or fragment");
    }
    if (!["http:", "https:"].includes(this.baseUrl.protocol)) throw new Error("Connector broker URL protocol is invalid");
    if (process.env.NODE_ENV === "production" && this.baseUrl.protocol !== "https:") {
      throw new Error("Production connector broker URL must use HTTPS");
    }
  }

  async execute(request: ConnectorBrokerRequest): Promise<ConnectorBrokerResponse> {
    return this.call("v1/execute", request, connectorBrokerResponseSchema);
  }

  async prepareAction(request: ConnectorActionPrepareRequest): Promise<ConnectorActionPrepareResponse> {
    return this.call("v1/actions/prepare", request, connectorActionPrepareResponseSchema);
  }

  async commitAction(request: ConnectorActionCommitRequest): Promise<ConnectorBrokerResponse> {
    return this.call("v1/actions/commit", request, connectorBrokerResponseSchema);
  }

  async capabilities() {
    return this.callRead("v1/capabilities");
  }

  async startOAuth(request: Record<string, unknown>) {
    return this.call("v1/oauth/start", request);
  }

  async revoke(request: Record<string, unknown>) {
    return this.call("v1/installations/revoke", request);
  }

  async rotate(request: Record<string, unknown>) {
    return this.call("v1/installations/rotate", request);
  }

  async health(request: Record<string, unknown>) {
    return this.call("v1/installations/health", request);
  }

  async activateWebhook(request: Record<string, unknown>) {
    return this.call("v1/installations/webhooks/activate", request);
  }

  private async call<T>(path: string, body: unknown, schema?: { parse(value: unknown): T }): Promise<T> {
    const token = await this.options.tokenProvider.getToken({ audience: this.options.audience });
    const metadata = brokerRequestMetadata(body);
    const response = await (this.options.fetcher ?? fetch)(new URL(path, ensureTrailingSlash(this.baseUrl)), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "x-loopgraph-request-id": metadata.requestId,
        "x-loopgraph-timestamp": new Date().toISOString(),
        ...(metadata.organizationId ? { "x-loopgraph-organization-id": metadata.organizationId } : {}),
        ...(metadata.projectKey ? { "x-loopgraph-project-key": metadata.projectKey } : {}),
        ...(metadata.installationId ? { "x-loopgraph-connection-id": metadata.installationId } : {}),
        ...(metadata.capability ? { "x-loopgraph-provider-capability": metadata.capability } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > 1024 * 1024) {
      throw new ConnectorBrokerClientError(502, "Connector broker response exceeded 1 MiB");
    }
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > 1024 * 1024) {
      throw new ConnectorBrokerClientError(502, "Connector broker response exceeded 1 MiB");
    }
    const payload = parseJson(responseText);
    if (!response.ok) {
      const safeMessage = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "string"
        ? redactSensitiveString((payload as Record<string, unknown>).error as string)
        : `Connector broker request failed (${response.status})`;
      throw new ConnectorBrokerClientError(response.status, safeMessage);
    }
    return schema ? schema.parse(payload) : payload as T;
  }

  private async callRead<T>(path: string): Promise<T> {
    const token = await this.options.tokenProvider.getToken({ audience: this.options.audience });
    const response = await (this.options.fetcher ?? fetch)(new URL(path, ensureTrailingSlash(this.baseUrl)), {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "x-loopgraph-request-id": `connector_${randomUUID()}`,
        "x-loopgraph-timestamp": new Date().toISOString(),
        ...(process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID ? { "x-loopgraph-organization-id": process.env.LOOPGRAPH_HOSTED_ORGANIZATION_ID } : {}),
        ...(process.env.LOOPGRAPH_HOSTED_PROJECT_KEY ? { "x-loopgraph-project-key": process.env.LOOPGRAPH_HOSTED_PROJECT_KEY } : {})
      },
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new ConnectorBrokerClientError(502, "Connector broker response exceeded 1 MiB");
    const payload = parseJson(text);
    if (!response.ok) throw new ConnectorBrokerClientError(response.status, `Connector broker request failed (${response.status})`);
    return payload as T;
  }
}

function brokerRequestMetadata(body: unknown) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const tenant = record.tenant && typeof record.tenant === "object"
    ? record.tenant as Record<string, unknown>
    : {};
  return {
    requestId: typeof record.requestId === "string" ? record.requestId : `connector_${randomUUID()}`,
    organizationId: typeof tenant.organizationId === "string" ? tenant.organizationId : undefined,
    projectKey: typeof tenant.projectKey === "string" ? tenant.projectKey : undefined,
    installationId: typeof record.installationId === "string" ? record.installationId : undefined,
    capability: typeof record.capability === "string" ? record.capability : undefined
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export class ConnectorBrokerClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ConnectorBrokerClientError";
  }
}

function ensureTrailingSlash(url: URL) {
  const copy = new URL(url);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}
import { randomUUID } from "node:crypto";
