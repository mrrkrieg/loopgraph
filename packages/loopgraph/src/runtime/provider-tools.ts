import { z } from "zod";
import { providerIdSchema } from "../core";
import { normalizeProviderEvent } from "./provider-normalizers";
import { prepareProviderInstallation, PROVIDER_ONBOARDING_CATALOG } from "./provider-onboarding";

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
  credentialRef: z.string().regex(/^(hermes|vault|keychain|env-ref):\/\//).optional(),
  includeOneTime: z.boolean().default(false)
});

export const providerEventNormalizeInputSchema = z.object({
  providerId: providerIdSchema,
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  sourceRoute: z.string().min(1),
  deliveryId: z.string().min(1),
  receivedAt: z.string().datetime().optional(),
  signatureVerified: z.boolean(),
  signer: z.string().min(1).optional(),
  payload: z.unknown()
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
    description: "Transform a signature-checked provider delivery into Loopgraph's bounded EventEnvelope contract.",
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
    if (parsed.includeOneTime) return plan;
    const { oneTime: _oneTime, ...redacted } = plan;
    return {
      ...redacted,
      oneTimeRedacted: true,
      nextAction: "Call again with includeOneTime=true only when Hermes is ready to store the state and PKCE verifier immediately."
    };
  }
  if (name === "loopgraph_provider_event_normalize") {
    const parsed = providerEventNormalizeInputSchema.parse(input);
    return normalizeProviderEvent(parsed, parsed.payload);
  }
  throw new Error(`Unknown Loopgraph provider tool: ${String(name)}`);
}
