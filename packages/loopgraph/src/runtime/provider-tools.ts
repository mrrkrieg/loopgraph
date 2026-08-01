import { z } from "zod";
import { providerIdSchema } from "../core";
import { normalizeProviderEvent } from "./provider-normalizers";
import { prepareProviderInstallation, PROVIDER_ONBOARDING_CATALOG } from "./provider-onboarding";
import { ProviderWebhookVerifier, providerWebhookVerificationReceiptSchema } from "./provider-webhook-verifier";

export const LOOPGRAPH_PROVIDER_TOOL_NAMES = [
  "loopgraph_provider_catalog_get",
  "loopgraph_provider_install_prepare",
  "loopgraph_provider_event_normalize"
] as const;

export type LoopgraphProviderToolName = (typeof LOOPGRAPH_PROVIDER_TOOL_NAMES)[number];

export const providerCatalogGetInputSchema = z.object({
  providerId: providerIdSchema.optional()
}).default({});

export const providerInstallPrepareInputSchema = z.object({
  providerId: providerIdSchema,
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  redirectUri: z.string().url().optional(),
  credentialRef: z.string().regex(/^(broker|hermes|aws-sm|gcp-sm|azure-kv|vault|keychain|env-ref):\/\//).optional()
});

export const providerEventNormalizeInputSchema = z.object({
  providerId: providerIdSchema,
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  sourceRoute: z.string().min(1),
  receivedAt: z.string().datetime().optional(),
  rawBody: z.string().max(1024 * 1024),
  verificationReceipt: providerWebhookVerificationReceiptSchema
});

export const loopgraphProviderToolDefinitions = [
  {
    name: "loopgraph_provider_catalog_get",
    description: "List Hermes-owned provider authorization, subscription, signature, and transformer contracts.",
    readOnly: true,
    idempotent: true
  },
  {
    name: "loopgraph_provider_install_prepare",
    description: "Prepare a least-privilege OAuth, provider-app, or admin-managed installation plan without storing provider tokens in Loopgraph.",
    readOnly: false,
    idempotent: false
  },
  {
    name: "loopgraph_provider_event_normalize",
    description: "Verify a broker-signed webhook receipt, then transform the delivery into Loopgraph's bounded EventEnvelope contract.",
    readOnly: true,
    idempotent: true
  }
] satisfies Array<{
  name: LoopgraphProviderToolName;
  description: string;
  readOnly: boolean;
  idempotent: boolean;
}>;

export async function callLoopgraphProviderTool(name: LoopgraphProviderToolName, input: unknown) {
  if (name === "loopgraph_provider_catalog_get") {
    const parsed = providerCatalogGetInputSchema.parse(input);
    const providers = PROVIDER_ONBOARDING_CATALOG.filter(
      (provider) => !parsed.providerId || provider.providerId === parsed.providerId
    );
    return { schemaVersion: "provider-catalog/v1alpha1", providers, count: providers.length };
  }
  if (name === "loopgraph_provider_install_prepare") {
    const parsed = providerInstallPrepareInputSchema.parse(input);
    const plan = prepareProviderInstallation(parsed);
    return {
      ...plan,
      nextAction: "Start consent through the Hermes Connector Broker so state and PKCE material are written directly to the configured vault."
    };
  }
  if (name === "loopgraph_provider_event_normalize") {
    const parsed = providerEventNormalizeInputSchema.parse(input);
    const signingKey = process.env.LOOPGRAPH_WEBHOOK_RECEIPT_SIGNING_KEY;
    const keyId = process.env.LOOPGRAPH_WEBHOOK_RECEIPT_KEY_ID;
    if (!signingKey || !keyId || parsed.verificationReceipt.keyId !== keyId) {
      throw new Error("Broker webhook receipt verification is not configured");
    }
    const verifier = new ProviderWebhookVerifier({
      replay: { claim: async () => false },
      receiptSigningKey: signingKey,
      receiptKeyId: keyId
    });
    if (!verifier.verifyReceipt(parsed.verificationReceipt, parsed.rawBody)) {
      throw new Error("Broker webhook verification receipt is invalid or expired");
    }
    if (parsed.verificationReceipt.providerId !== parsed.providerId) {
      throw new Error("Broker webhook verification receipt provider mismatch");
    }
    const payload = JSON.parse(parsed.rawBody) as unknown;
    return normalizeProviderEvent({
      providerId: parsed.providerId,
      workspaceId: parsed.workspaceId,
      companyId: parsed.companyId,
      sourceRoute: parsed.sourceRoute,
      deliveryId: parsed.verificationReceipt.deliveryId,
      receivedAt: parsed.receivedAt,
      signatureVerified: true,
      signer: parsed.verificationReceipt.signer
    }, payload);
  }
  throw new Error(`Unknown Loopgraph provider tool: ${String(name)}`);
}
