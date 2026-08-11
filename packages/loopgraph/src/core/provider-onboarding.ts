import { z } from "zod";
import { credentialReferenceSchema } from "./credential-reference";

export const PROVIDER_ONBOARDING_SCHEMA_VERSION = "provider-onboarding/v1alpha1" as const;
export const PROVIDER_INSTALLATION_SCHEMA_VERSION = "provider-installation/v1alpha1" as const;

export const providerIdSchema = z.enum([
  "hubspot",
  "google_ads",
  "slack",
  "notion",
  "salesforce",
  "stripe",
  "github",
  "zendesk",
  "intercom",
  "workday",
  "greenhouse",
  "netsuite",
  "quickbooks",
  "gmail",
  "google_calendar",
  "outlook",
  "teams",
  "posthog",
  "amplitude"
]);

export const providerOnboardingProfileSchema = z.object({
  schemaVersion: z.literal(PROVIDER_ONBOARDING_SCHEMA_VERSION).default(PROVIDER_ONBOARDING_SCHEMA_VERSION),
  providerId: providerIdSchema,
  label: z.string().min(1),
  systemClass: z.enum(["crm", "ads", "messaging", "knowledge", "payments", "repository", "support", "hris", "finance", "email", "calendar", "analytics"]),
  controlPlane: z.literal("hermes").default("hermes"),
  authorization: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("oauth2"),
      authorizationUrl: z.string().url(),
      tokenUrl: z.string().url(),
      scopes: z.array(z.string().min(1)).min(1),
      pkce: z.boolean().default(true),
      extraAuthorizeParameters: z.record(z.string(), z.string()).default({})
    }),
    z.object({
      mode: z.literal("provider_app"),
      installationUrl: z.string().url(),
      permissions: z.array(z.string().min(1)).min(1),
      manifestSupported: z.boolean().default(false)
    }),
    z.object({
      mode: z.literal("admin_managed"),
      instructionsUrl: z.string().url(),
      credentialKind: z.enum(["api_key", "service_account", "connected_app"])
    })
  ]),
  ingestion: z.object({
    mode: z.enum(["webhook_api", "event_stream", "provider_console", "scheduled_detector"]),
    eventFamilies: z.array(z.string().min(1)).min(1),
    transformerId: z.string().min(1),
    signatureStrategy: z.string().min(1),
    subscriptionApi: z.string().url().optional(),
    pollCadenceMinutes: z.number().int().positive().optional()
  }),
  leastPrivilegeNotes: z.array(z.string().min(1)).default([])
});

export const providerInstallationSchema = z.object({
  schemaVersion: z.literal(PROVIDER_INSTALLATION_SCHEMA_VERSION).default(PROVIDER_INSTALLATION_SCHEMA_VERSION),
  id: z.string().min(1),
  providerId: providerIdSchema,
  workspaceId: z.string().min(1),
  companyId: z.string().min(1),
  status: z.enum(["prepared", "awaiting_consent", "connected", "subscription_pending", "active", "degraded", "rotating", "revoking", "failed", "revoked", "disconnected"]),
  credentialRef: credentialReferenceSchema,
  redirectUri: z.string().url().optional(),
  stateHash: z.string().min(16).optional(),
  grantedScopes: z.array(z.string().min(1)).default([]),
  subscription: z.object({
    endpointRef: z.string().min(1),
    subscribedEventFamilies: z.array(z.string().min(1)),
    providerSubscriptionId: z.string().min(1).optional(),
    verifiedAt: z.string().datetime().optional()
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type ProviderOnboardingProfile = z.infer<typeof providerOnboardingProfileSchema>;
export type ProviderInstallation = z.infer<typeof providerInstallationSchema>;
