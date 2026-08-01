import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AwsSecretsManagerClient } from "./vault-adapters";

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: number;
};

export class AwsWorkloadSecretsManagerClient implements AwsSecretsManagerClient {
  private credentials?: AwsCredentials;

  constructor(private readonly options: {
    region: string;
    fetcher?: typeof fetch;
    now?: () => Date;
  }) {
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(options.region)) throw new Error("Invalid AWS region");
  }

  async getSecretValue(input: { secretId: string }) {
    const body = await this.call("GetSecretValue", { SecretId: input.secretId }) as Record<string, unknown>;
    return {
      secretString: typeof body.SecretString === "string" ? body.SecretString : undefined,
      secretBinary: typeof body.SecretBinary === "string" ? Buffer.from(body.SecretBinary, "base64") : undefined,
      versionId: typeof body.VersionId === "string" ? body.VersionId : undefined
    };
  }

  async putSecretValue(input: { secretId: string; secretString: string; customerManagedKeyRef?: string }) {
    try {
      const body = await this.call("PutSecretValue", {
        SecretId: input.secretId,
        SecretString: input.secretString,
        ClientRequestToken: randomUUID()
      }) as Record<string, unknown>;
      return { versionId: typeof body.VersionId === "string" ? body.VersionId : undefined };
    } catch (error) {
      if (!(error instanceof AwsServiceError) || error.code !== "ResourceNotFoundException") throw error;
      const kmsKeyId = input.customerManagedKeyRef?.replace(/^aws-kms:\/\//, "");
      const body = await this.call("CreateSecret", {
        Name: input.secretId,
        SecretString: input.secretString,
        ClientRequestToken: randomUUID(),
        ...(kmsKeyId ? { KmsKeyId: kmsKeyId } : {}),
        Tags: [{ Key: "managed-by", Value: "loopgraph-hermes-connector-broker" }]
      }) as Record<string, unknown>;
      return { versionId: typeof body.VersionId === "string" ? body.VersionId : undefined };
    }
  }

  async deleteSecret(input: { secretId: string }) {
    try {
      await this.call("DeleteSecret", { SecretId: input.secretId, RecoveryWindowInDays: 7 });
    } catch (error) {
      if (!(error instanceof AwsServiceError) || error.code !== "ResourceNotFoundException") throw error;
    }
  }

  private async call(action: string, payload: Record<string, unknown>) {
    const credentials = await this.getCredentials();
    const now = this.options.now?.() ?? new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const host = `secretsmanager.${this.options.region}.amazonaws.com`;
    const target = `secretsmanager.${action}`;
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/x-amz-json-1.1",
      host,
      "x-amz-date": amzDate,
      "x-amz-target": target,
      ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {})
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${headers[key].trim()}\n`).join("");
    const canonicalRequest = [
      "POST",
      "/",
      "",
      canonicalHeaders,
      signedHeaderNames.join(";"),
      sha256(body)
    ].join("\n");
    const scope = `${date}/${this.options.region}/secretsmanager/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), this.options.region), "secretsmanager"), "aws4_request");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
    const response = await this.fetcher()(`https://${host}/`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const rawCode = typeof result.__type === "string" ? result.__type : typeof result.code === "string" ? result.code : "AwsServiceError";
      throw new AwsServiceError(rawCode.split("#").at(-1) ?? "AwsServiceError", response.status);
    }
    return result;
  }

  private async getCredentials() {
    if (this.credentials && (!this.credentials.expiresAt || this.credentials.expiresAt > Date.now() + 60_000)) return this.credentials;
    this.credentials = await resolveAwsWorkloadCredentials(this.fetcher(), this.options.region);
    return this.credentials;
  }

  private fetcher() {
    return this.options.fetcher ?? fetch;
  }
}

export class AwsServiceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`AWS Secrets Manager request failed: ${code} (${status})`);
    this.name = "AwsServiceError";
  }
}

async function resolveAwsWorkloadCredentials(fetcher: typeof fetch, region: string): Promise<AwsCredentials> {
  const webIdentityFile = process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
  const roleArn = process.env.AWS_ROLE_ARN;
  if (webIdentityFile || roleArn) {
    if (!webIdentityFile || !roleArn || !webIdentityFile.startsWith("/") || !/^arn:aws(?:-[a-z]+)*:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/.test(roleArn)) {
      throw new Error("AWS workload identity configuration is invalid");
    }
    const token = boundedCredential(await readFile(webIdentityFile, "utf8"), "AWS web identity token", 64 * 1024);
    const body = new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      RoleArn: roleArn,
      RoleSessionName: `loopgraph-connector-${process.pid}`,
      WebIdentityToken: token
    });
    const response = await fetcher(`https://sts.${region}.amazonaws.com/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/xml" },
      body,
      signal: AbortSignal.timeout(10_000)
    });
    const xml = await boundedResponseText(response, 128 * 1024);
    if (!response.ok) throw new Error(`AWS workload identity exchange failed (${response.status})`);
    return {
      accessKeyId: xmlTag(xml, "AccessKeyId"),
      secretAccessKey: xmlTag(xml, "SecretAccessKey"),
      sessionToken: xmlTag(xml, "SessionToken"),
      expiresAt: Date.parse(xmlTag(xml, "Expiration"))
    };
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    if (
      process.env.NODE_ENV === "production" &&
      !process.env.AWS_SESSION_TOKEN &&
      process.env.LOOPGRAPH_ALLOW_STATIC_AWS_CREDENTIALS !== "true"
    ) {
      throw new Error("Static AWS credentials are disabled in production; configure a workload role");
    }
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    };
  }
  const relative = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const full = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (relative || full) {
    const endpoint = relative ? `http://169.254.170.2${relative}` : validateContainerCredentialUrl(full!);
    const authorization = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN ??
      (process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE
        ? (await readFile(process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE, "utf8")).trim()
        : undefined);
    const response = await fetcher(endpoint, {
      headers: authorization ? { authorization } : undefined,
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`AWS container credential request failed (${response.status})`);
    return parseAwsCredentials(await response.json());
  }

  const tokenResponse = await fetcher("http://169.254.169.254/latest/api/token", {
    method: "PUT",
    headers: { "x-aws-ec2-metadata-token-ttl-seconds": "300" },
    signal: AbortSignal.timeout(5_000)
  });
  if (!tokenResponse.ok) throw new Error("AWS IMDSv2 token request failed");
  const token = await tokenResponse.text();
  const headers = { "x-aws-ec2-metadata-token": token };
  const roleResponse = await fetcher("http://169.254.169.254/latest/meta-data/iam/security-credentials/", { headers, signal: AbortSignal.timeout(5_000) });
  if (!roleResponse.ok) throw new Error("AWS workload role lookup failed");
  const role = (await roleResponse.text()).trim();
  if (!/^[A-Za-z0-9+=,.@_-]{1,128}$/.test(role)) throw new Error("AWS workload role name is invalid");
  const credentialResponse = await fetcher(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${role}`, { headers, signal: AbortSignal.timeout(5_000) });
  if (!credentialResponse.ok) throw new Error("AWS workload credentials request failed");
  return parseAwsCredentials(await credentialResponse.json());
}

function parseAwsCredentials(value: unknown): AwsCredentials {
  const body = value as Record<string, unknown>;
  const accessKeyId = body.AccessKeyId;
  const secretAccessKey = body.SecretAccessKey;
  if (typeof accessKeyId !== "string" || typeof secretAccessKey !== "string") throw new Error("AWS workload credential response is invalid");
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: typeof body.Token === "string" ? body.Token : undefined,
    expiresAt: typeof body.Expiration === "string" ? Date.parse(body.Expiration) : undefined
  };
}

function validateContainerCredentialUrl(value: string) {
  const url = new URL(value);
  const allowed = url.protocol === "http:" && ["127.0.0.1", "localhost", "169.254.170.2", "169.254.170.23"].includes(url.hostname);
  if (!allowed || url.username || url.password) throw new Error("AWS container credential URL is not trusted");
  return url.toString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function boundedCredential(value: string, label: string, maximum: number) {
  const result = value.trim();
  if (result.length < 16 || Buffer.byteLength(result, "utf8") > maximum || /\s/.test(result)) {
    throw new Error(`${label} has an invalid shape`);
  }
  return result;
}

async function boundedResponseText(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new Error("AWS identity response is too large");
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maximum) throw new Error("AWS identity response is too large");
  return value;
}

function xmlTag(xml: string, tag: string) {
  const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  if (!match?.[1]) throw new Error("AWS workload identity response is invalid");
  return match[1];
}
