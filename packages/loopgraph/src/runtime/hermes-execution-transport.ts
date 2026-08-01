import { createHmac, timingSafeEqual } from "node:crypto";
import {
  hermesExecutionAssignmentSchema,
  type HermesExecutionAssignment
} from "../core";

export type HermesExecutionDispatchResult = {
  accepted: boolean;
  responseStatus?: number;
  assignmentRef?: string;
  error?: string;
};

export interface HermesExecutionTransport {
  dispatch(assignment: HermesExecutionAssignment): Promise<HermesExecutionDispatchResult>;
}

export class HttpHermesExecutionTransport implements HermesExecutionTransport {
  constructor(private options: {
    url: string;
    secret: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) {
    validateHermesExecutionUrl(options.url);
    if (options.secret.length < 32) throw new Error("Hermes execution secret must contain at least 32 characters");
  }

  async dispatch(assignment: HermesExecutionAssignment): Promise<HermesExecutionDispatchResult> {
    const parsed = hermesExecutionAssignmentSchema.parse(assignment);
    const body = JSON.stringify(parsed);
    const timestamp = String(Math.floor((this.options.now?.() ?? new Date()).getTime() / 1_000));
    const signature = signHermesExecutionPayload(body, timestamp, this.options.secret);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hermes-signature": signature,
          "x-hermes-timestamp": timestamp,
          "x-request-id": parsed.assignmentId,
          "x-loopgraph-route-job-id": parsed.routeJobId
        },
        body,
        redirect: "error"
      });
      const responseBody = await readJson(response);
      return {
        accepted: response.ok,
        responseStatus: response.status,
        ...(readString(responseBody, "assignmentId") || readString(responseBody, "id")
          ? { assignmentRef: readString(responseBody, "assignmentId") ?? readString(responseBody, "id") }
          : {}),
        ...(!response.ok
          ? { error: readString(responseBody, "error") ?? `Hermes execution endpoint returned ${response.status}` }
          : {})
      };
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : "Hermes execution dispatch failed"
      };
    }
  }
}

export function resolveHermesExecutionTransport(options: {
  transport?: HermesExecutionTransport;
  url?: string;
  secret?: string;
} = {}): HermesExecutionTransport | undefined {
  if (options.transport) return options.transport;
  const url = options.url ?? process.env.LOOPGRAPH_HERMES_EXECUTION_URL;
  if (!url) return undefined;
  const secret = options.secret ?? process.env.LOOPGRAPH_HERMES_EXECUTION_SECRET;
  if (!secret) throw new Error("LOOPGRAPH_HERMES_EXECUTION_SECRET is required when LOOPGRAPH_HERMES_EXECUTION_URL is configured");
  return new HttpHermesExecutionTransport({ url, secret });
}

export function signHermesExecutionPayload(body: string, timestamp: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyHermesExecutionPayload(input: {
  body: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: Date;
  maxClockSkewSeconds?: number;
}): boolean {
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (Math.abs(nowSeconds - timestampSeconds) > (input.maxClockSkewSeconds ?? 300)) return false;
  const expected = signHermesExecutionPayload(input.body, input.timestamp, input.secret);
  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function validateHermesExecutionUrl(value: string): void {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Hermes execution URL must use HTTP or HTTPS");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local && process.env.NODE_ENV === "production") {
    throw new Error("Hermes execution URL must use HTTPS outside local development");
  }
  if (url.username || url.password) throw new Error("Hermes execution URL must not contain embedded credentials");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function readString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
