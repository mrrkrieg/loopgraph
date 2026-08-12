import { randomUUID } from "node:crypto";
import {
  PROVIDER_INSTALLATION_SCHEMA_VERSION,
  buildCredentialNamespace,
  providerInstallationSchema,
  providerOnboardingProfileSchema,
  type ProviderId,
  type ProviderInstallation,
  type ProviderOnboardingProfile
} from "../core";

const oauth = (
  authorizationUrl: string,
  tokenUrl: string,
  scopes: string[],
  pkce = true,
  extraAuthorizeParameters: Record<string, string> = {}
) => ({ mode: "oauth2" as const, authorizationUrl, tokenUrl, scopes, pkce, extraAuthorizeParameters });

export const PROVIDER_ONBOARDING_CATALOG: ProviderOnboardingProfile[] = [
  profile("hubspot", "HubSpot", "crm", oauth("https://app.hubspot.com/oauth/authorize", "https://api.hubapi.com/oauth/v1/token", ["crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read"]), "webhook_api", ["company.propertyChange", "contact.propertyChange", "deal.propertyChange"], "hubspot/v1", "HubSpot v3 request signature", "https://api.hubapi.com/webhooks/v3/{appId}/subscriptions"),
  profile("google_ads", "Google Ads", "ads", oauth("https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", ["https://www.googleapis.com/auth/adwords"], true, { access_type: "offline", prompt: "consent" }), "scheduled_detector", ["campaign.performance_anomaly", "campaign.budget_alert"], "google-ads/v1", "Hermes detector receipt", undefined, 15),
  profile("slack", "Slack", "messaging", oauth("https://slack.com/oauth/v2/authorize", "https://slack.com/api/oauth.v2.access", ["app_mentions:read", "channels:history"]), "provider_console", ["app_mention", "message.channels"], "slack/v1", "Slack v0 HMAC timestamp signature"),
  profile("notion", "Notion", "knowledge", oauth("https://api.notion.com/v1/oauth/authorize", "https://api.notion.com/v1/oauth/token", ["read_content"]), "provider_console", ["page.content_updated", "page.properties_updated"], "notion/v1", "Notion webhook HMAC"),
  profile("salesforce", "Salesforce", "crm", oauth("https://login.salesforce.com/services/oauth2/authorize", "https://login.salesforce.com/services/oauth2/token", ["api", "refresh_token", "offline_access"]), "event_stream", ["AccountChangeEvent", "OpportunityChangeEvent", "CaseChangeEvent"], "salesforce-cdc/v1", "Salesforce Pub/Sub OAuth identity"),
  profile("stripe", "Stripe", "payments", oauth("https://connect.stripe.com/oauth/authorize", "https://connect.stripe.com/oauth/token", ["read_only"], false), "webhook_api", ["customer.updated", "invoice.payment_failed", "charge.dispute.created", "customer.subscription.updated"], "stripe/v1", "Stripe-Signature HMAC", "https://api.stripe.com/v1/webhook_endpoints"),
  providerOnboardingProfileSchema.parse({ schemaVersion: "provider-onboarding/v1alpha1", providerId: "github", label: "GitHub", systemClass: "repository", controlPlane: "hermes", authorization: { mode: "provider_app", installationUrl: "https://github.com/settings/apps/new", permissions: ["metadata:read", "contents:read", "issues:read", "pull_requests:read"], manifestSupported: true }, ingestion: { mode: "webhook_api", eventFamilies: ["issues", "issue_comment", "pull_request", "repository"], transformerId: "github/v1", signatureStrategy: "X-Hub-Signature-256 HMAC", subscriptionApi: "https://api.github.com/app/hook/config" }, leastPrivilegeNotes: ["Hermes submits a generated GitHub App manifest, stores the resulting private key, and installs write permissions separately only when an approved loop requires them."] }),
  adminProfile("zendesk", "Zendesk", "support", "api_key", "https://developer.zendesk.com/documentation/webhooks/", ["ticket.created", "ticket.updated", "satisfaction.updated"], "zendesk/v1", "Zendesk webhook signing secret"),
  profile("intercom", "Intercom", "support", oauth("https://app.intercom.com/oauth", "https://api.intercom.io/auth/eagle/token", ["read_conversations", "read_contacts"]), "webhook_api", ["conversation.user.created", "conversation.admin.replied", "contact.updated"], "intercom/v1", "Intercom X-Hub-Signature", "https://api.intercom.io/subscriptions"),
  adminProfile("workday", "Workday", "hris", "connected_app", "https://developer.workday.com/", ["worker.changed", "job_application.changed"], "workday/v1", "mTLS or Workday integration identity"),
  profile("greenhouse", "Greenhouse", "hris", oauth("https://api.greenhouse.io/oauth/authorize", "https://api.greenhouse.io/oauth/token", ["candidates:read", "jobs:read"], true), "webhook_api", ["candidate.created", "candidate.stage_changed", "offer.updated"], "greenhouse/v1", "Greenhouse webhook signature"),
  adminProfile("netsuite", "NetSuite", "finance", "connected_app", "https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_157769826287.html", ["invoice.changed", "purchase_order.changed", "forecast.changed"], "netsuite/v1", "NetSuite OAuth 2.0 client credentials"),
  adminProfile("quickbooks", "QuickBooks", "finance", "connected_app", "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization", ["invoice", "payment", "purchase"], "quickbooks/v1", "Intuit verifier token plus OAuth identity"),
  profile("gmail", "Gmail", "email", oauth("https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", ["https://www.googleapis.com/auth/gmail.readonly"], true, { access_type: "offline", prompt: "consent" }), "scheduled_detector", ["mail.thread.changed", "mail.delivery.observed"], "gmail/v1", "Hermes detector receipt", undefined, 15),
  profile("google_calendar", "Google Calendar", "calendar", oauth("https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", ["https://www.googleapis.com/auth/calendar.events.readonly"], true, { access_type: "offline", prompt: "consent" }), "scheduled_detector", ["calendar.event.changed"], "google-calendar/v1", "Hermes detector receipt", undefined, 15),
  profile("outlook", "Microsoft Outlook", "email", oauth("https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "https://login.microsoftonline.com/common/oauth2/v2.0/token", ["offline_access", "Mail.Read", "Calendars.Read"], true), "event_stream", ["mail.message.changed", "calendar.event.changed"], "microsoft-graph-outlook/v1", "Microsoft Graph change-notification validation"),
  profile("teams", "Microsoft Teams", "messaging", oauth("https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "https://login.microsoftonline.com/common/oauth2/v2.0/token", ["offline_access", "ChannelMessage.Read.All"], true), "event_stream", ["teams.channel.message.created"], "microsoft-graph-teams/v1", "Microsoft Graph change-notification validation"),
  detectorAdminProfile("posthog", "PostHog", "analytics", "api_key", "https://posthog.com/docs/api", ["insight.updated", "metric.threshold_crossed"], "posthog/v1", 15),
  detectorAdminProfile("amplitude", "Amplitude", "analytics", "api_key", "https://amplitude.com/docs/apis/authentication", ["chart.updated", "metric.threshold_crossed"], "amplitude/v1", 15),
  profile("linear", "Linear", "issue_tracker", oauth("https://linear.app/oauth/authorize", "https://api.linear.app/oauth/token", ["read"], true, { actor: "app" }), "webhook_api", ["Issue", "Comment", "Project", "ProjectUpdate", "OAuthApp"], "linear/v1", "Linear-Signature HMAC with a fresh webhook timestamp"),
  profile("jira", "Jira Cloud", "issue_tracker", oauth("https://auth.atlassian.com/authorize", "https://auth.atlassian.com/oauth/token", ["read:jira-work", "manage:jira-webhook", "offline_access"], true, { audience: "api.atlassian.com", prompt: "consent" }), "webhook_api", ["jira:issue_created", "jira:issue_updated", "jira:version_released"], "jira-cloud/v1", "Atlassian OAuth webhook bearer JWT plus a tenant-scoped Loopgraph callback binding", "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/webhook"),
  profile("gitlab", "GitLab.com", "repository", oauth("https://gitlab.com/oauth/authorize", "https://gitlab.com/oauth/token", ["read_api"], true), "provider_console", ["Issue Hook", "Deployment Hook", "Release Hook"], "gitlab/v1", "GitLab Standard Webhooks HMAC signing token; legacy secret token accepted only for migration")
];

export function getProviderOnboardingProfile(providerId: ProviderId): ProviderOnboardingProfile {
  const profile = PROVIDER_ONBOARDING_CATALOG.find((candidate) => candidate.providerId === providerId);
  if (!profile) throw new Error(`Unsupported provider: ${providerId}`);
  return profile;
}

export function prepareProviderInstallation(input: {
  providerId: ProviderId;
  workspaceId: string;
  companyId: string;
  redirectUri?: string;
  credentialRef?: string;
  now?: Date;
}) {
  const provider = getProviderOnboardingProfile(input.providerId);
  const now = (input.now ?? new Date()).toISOString();
  const installationId = `provider_${randomUUID()}`;
  const credentialNamespace = buildCredentialNamespace({
    organizationId: input.companyId,
    projectKey: input.workspaceId,
    providerId: input.providerId,
    installationId
  });
  const installation: ProviderInstallation = providerInstallationSchema.parse({
    schemaVersion: PROVIDER_INSTALLATION_SCHEMA_VERSION,
    id: installationId,
    providerId: input.providerId,
    workspaceId: input.workspaceId,
    companyId: input.companyId,
    status: "prepared",
    credentialRef: input.credentialRef ?? `broker://${credentialNamespace}/tokens/provider`,
    redirectUri: input.redirectUri,
    createdAt: now,
    updatedAt: now
  });
  return {
    schemaVersion: "provider-install-plan/v1alpha1" as const,
    installation,
    provider,
    authorizationUrl: undefined,
    oneTimeRedacted: true,
    brokerStartEndpoint: "/api/connector-broker/v1/installations/start",
    hermesActions: [
      "Ask the Hermes Connector Broker to start consent; it creates state and PKCE inside the vault boundary.",
      "Complete provider consent; the broker stores the token under credentialRef and applies the declared event subscription.",
      "Send only the non-secret installation receipt and signed normalized EventEnvelopes to Loopgraph."
    ]
  };
}

function profile(providerId: ProviderId, label: string, systemClass: ProviderOnboardingProfile["systemClass"], authorization: Extract<ProviderOnboardingProfile["authorization"], { mode: "oauth2" }>, mode: ProviderOnboardingProfile["ingestion"]["mode"], eventFamilies: string[], transformerId: string, signatureStrategy: string, subscriptionApi?: string, pollCadenceMinutes?: number) {
  return providerOnboardingProfileSchema.parse({ schemaVersion: "provider-onboarding/v1alpha1", providerId, label, systemClass, controlPlane: "hermes", authorization, ingestion: { mode, eventFamilies, transformerId, signatureStrategy, subscriptionApi, pollCadenceMinutes }, leastPrivilegeNotes: ["Begin read-only and in shadow mode; add write scopes only after fingerprint-bound approval."] });
}

function adminProfile(providerId: ProviderId, label: string, systemClass: ProviderOnboardingProfile["systemClass"], credentialKind: "api_key" | "service_account" | "connected_app", instructionsUrl: string, eventFamilies: string[], transformerId: string, signatureStrategy: string) {
  return providerOnboardingProfileSchema.parse({ schemaVersion: "provider-onboarding/v1alpha1", providerId, label, systemClass, controlPlane: "hermes", authorization: { mode: "admin_managed", instructionsUrl, credentialKind }, ingestion: { mode: "provider_console", eventFamilies, transformerId, signatureStrategy }, leastPrivilegeNotes: ["Use a dedicated, read-only integration identity and rotate credentials through Hermes."] });
}

function detectorAdminProfile(providerId: ProviderId, label: string, systemClass: ProviderOnboardingProfile["systemClass"], credentialKind: "api_key" | "service_account" | "connected_app", instructionsUrl: string, eventFamilies: string[], transformerId: string, pollCadenceMinutes: number) {
  return providerOnboardingProfileSchema.parse({ schemaVersion: "provider-onboarding/v1alpha1", providerId, label, systemClass, controlPlane: "hermes", authorization: { mode: "admin_managed", instructionsUrl, credentialKind }, ingestion: { mode: "scheduled_detector", eventFamilies, transformerId, signatureStrategy: "Hermes signed detector receipt", pollCadenceMinutes }, leastPrivilegeNotes: ["Use a dedicated, read-only project key, store it only in the Connector Broker vault, and rotate it through Hermes."] });
}
