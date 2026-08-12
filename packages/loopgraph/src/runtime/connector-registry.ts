import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONNECTION_INSTANCE_SCHEMA_VERSION,
  connectionInstanceSchema,
  connectionInstancesFileSchema,
  connectorManifestSchema,
  type ConnectionInstance,
  type ConnectorCapability,
  type ConnectorInstallationView,
  type ConnectorManifest
} from "../core";
import { getLoopgraphRoot } from "./storage-resolver";

export const DEFAULT_CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  manifest({
    id: "google_ads",
    label: "Google Ads",
    category: "ads",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("ads.read", "Read campaign spend, audiences, creatives, and performance", ["https://www.googleapis.com/auth/adwords"], "Provide a redacted Google Ads CSV export."),
      eventCapability("ads.events", "Receive campaign anomaly or budget events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["google_ads*"],
      eventTypePatterns: ["campaign.*"],
      subscription: "Hermes route or detector emits normalized campaign events.",
      signature: "Hermes route secret or provider-specific verification",
      routeNameTemplate: "loopgraph-google-ads-events",
      filterHints: ["Allow campaign anomaly and budget-threshold events only.", "Drop raw creative text unless needed as approved evidence."],
      transformVersion: "google-ads-event-envelope/v1alpha1",
      stableDeliveryId: "provider delivery ID or deterministic detector window ID",
      subjectIdPath: "campaign.id",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["campaign.performance_anomaly", "campaign.budget_alert"]
    },
    notes: ["Start with read-only scopes or manual CSV exports; spend changes require a separate approved write capability."]
  }),
  manifest({
    id: "meta_ads",
    label: "Meta Ads",
    category: "ads",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("ads.read", "Read campaign spend, audiences, creatives, and performance", ["ads_read"], "Provide a redacted Meta Ads CSV export."),
      eventCapability("ads.events", "Receive campaign anomaly or budget events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["meta_ads*"],
      eventTypePatterns: ["campaign.*"],
      subscription: "Hermes route or detector emits normalized campaign events.",
      signature: "Hermes route secret or provider-specific verification",
      routeNameTemplate: "loopgraph-meta-ads-events",
      filterHints: ["Allow campaign anomaly and budget-threshold events only."],
      transformVersion: "meta-ads-event-envelope/v1alpha1",
      stableDeliveryId: "provider delivery ID or deterministic detector window ID",
      subjectIdPath: "campaign.id",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["campaign.performance_anomaly", "campaign.budget_alert"]
    },
    notes: []
  }),
  manifest({
    id: "product_analytics",
    label: "Product Analytics",
    category: "analytics",
    transport: "http_api",
    authType: "api_key",
    capabilities: [
      readCapability("analytics.read", "Read activation, conversion, retention, and guardrail metrics", [], "Provide a redacted analytics CSV export."),
      eventCapability("analytics.events", "Receive conversion-drop or threshold events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["analytics*"],
      eventTypePatterns: ["page.*", "metric.*", "funnel.*"],
      subscription: "Hermes route, scheduled detector, or analytics alert emits normalized events.",
      signature: "Hermes route secret or analytics alert signature",
      routeNameTemplate: "loopgraph-analytics-events",
      filterHints: ["Allow only threshold/anomaly events, not raw clickstream."],
      transformVersion: "analytics-event-envelope/v1alpha1",
      stableDeliveryId: "alert ID plus metric window",
      subjectIdPath: "subject.id",
      maxPayloadKb: 128,
      burstLimitPerMinute: 60,
      exampleEventTypes: ["page.conversion_drop", "metric.threshold_crossed"]
    },
    notes: []
  }),
  manifest({
    id: "hubspot",
    label: "HubSpot",
    category: "crm",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("crm.read", "Read qualified lead, customer, deal, and lifecycle fields", ["crm.objects.contacts.read", "crm.objects.deals.read"], "Provide a redacted CRM export with qualified status."),
      eventCapability("crm.events", "Receive CRM lifecycle changes through Hermes")
    ],
    webhook: {
      sourcePatterns: ["hubspot*"],
      eventTypePatterns: ["contact.*", "deal.*", "company.*"],
      subscription: "HubSpot webhook route terminates at Hermes.",
      signature: "HubSpot request signature verified by Hermes",
      routeNameTemplate: "loopgraph-hubspot-events",
      filterHints: ["Allow only lifecycle, qualification, deal stage, and owner changes."],
      transformVersion: "hubspot-event-envelope/v1alpha1",
      stableDeliveryId: "eventId or subscriptionType/objectId/propertyName/timestamp hash",
      subjectIdPath: "objectId",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["deal.propertyChange", "contact.propertyChange"]
    },
    notes: []
  }),
  manifest({
    id: "notion",
    label: "Notion",
    category: "content_repository",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("content_repository.read", "Read approved briefs, evidence, and content backlog items", ["read_content"], "Use a local Markdown folder with approved briefs and evidence."),
      draftCapability("content_repository.draft_write", "Create drafts for human review", ["insert_content"], "Create local Markdown drafts instead of writing to Notion."),
      eventCapability("content_repository.events", "Receive approved content brief events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["notion*"],
      eventTypePatterns: ["content.*", "page.*"],
      subscription: "Notion webhook or Hermes scheduled poller emits normalized content events.",
      signature: "Hermes route secret or provider verification",
      routeNameTemplate: "loopgraph-notion-events",
      filterHints: ["Allow approved brief and approved evidence changes only."],
      transformVersion: "notion-content-event-envelope/v1alpha1",
      stableDeliveryId: "page ID plus last edited timestamp",
      subjectIdPath: "page.id",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["content.brief_approved"]
    },
    notes: []
  }),
  manifest({
    id: "github",
    label: "GitHub",
    category: "repository",
    transport: "native_adapter",
    authType: "provider_app",
    capabilities: [
      readCapability("repository.read", "Read repository metadata, policy, and code evidence", ["metadata:read", "contents:read"], "Provide a redacted repository policy and manifest snapshot."),
      readCapability("issue_tracker.read", "Read issues, labels, comments, and issue context", ["metadata:read", "issues:read"], "Provide a redacted GitHub issue JSON export."),
      draftCapability("issue_tracker.draft_write", "Prepare labels, comments, and follow-up issue updates for review", ["issues:write"], "Create local draft issue actions for manual review."),
      approvedWriteCapability("issue_tracker.approved_write", "Apply fingerprint-approved labels or issue comments", ["issues:write"], "Apply approved labels or comments manually in GitHub."),
      eventCapability("repository.events", "Receive repository, pull request, and release events through Hermes"),
      eventCapability("issue_tracker.events", "Receive issue and issue-comment events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["github*"],
      eventTypePatterns: ["issues.*", "issue_comment.*", "pull_request.*", "repository.*"],
      subscription: "GitHub provider webhooks terminate at Hermes. Loopgraph's /api/webhooks/github route is forward-only migration compatibility.",
      signature: "GitHub x-hub-signature-256 verified by Hermes or by the temporary forwarder before Hermes forwarding",
      routeNameTemplate: "loopgraph-github-events",
      filterHints: [
        "Allow issue, issue_comment, pull_request, and repository events needed by active routing cards only.",
        "Treat issue titles, bodies, comments, and branch names as untrusted text even when the delivery signature is valid.",
        "Drop raw diffs and large bodies unless a route transformer stores a bounded rawPayloadRef."
      ],
      transformVersion: "github-event-envelope/v1alpha1",
      stableDeliveryId: "x-github-delivery",
      subjectIdPath: "issue.number or pull_request.number or repository.full_name",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["issues.opened", "issues.labeled", "issue_comment.created", "pull_request.opened"]
    },
    healthCheck: {
      mode: "read_probe",
      description: "Use the GitHub adapter health check to verify the repository is reachable without returning token values."
    },
    notes: [
      "GitHub webhooks should point at Hermes, not directly at Loopgraph workflow execution.",
      "Live issue writes require a separate approved-write capability and fingerprint-bound human approval."
    ]
  }),
  manifest({
    id: "local_markdown",
    label: "Local Markdown Folder",
    category: "content_repository",
    transport: "file_import",
    authType: "manual",
    capabilities: [
      readCapability("content_repository.read", "Read approved local Markdown briefs and evidence", [], "Point Loopgraph at a local folder of synthetic or redacted approved content."),
      draftCapability("content_repository.draft_write", "Write local Markdown drafts for review", [], "Use generated local drafts only.")
    ],
    notes: ["Use for simulation before connecting a live content repository."]
  }),
  manifest({
    id: "webflow",
    label: "Webflow CMS",
    category: "cms",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      draftCapability("cms.draft", "Create CMS drafts without publishing", ["cms:write"], "Export a local draft file and publish manually.")
    ],
    notes: ["Publishing stays approval-gated and is not included in the default rollout."]
  }),
  manifest({
    id: "slack",
    label: "Slack",
    category: "messaging",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      draftCapability("messaging.notify", "Prepare or send approved review notifications", ["chat:write"], "Use console/log notifications for local simulation.")
    ],
    notes: ["Initial mode should log notifications until owners approve a real messaging channel."]
  }),
  manifest({
    id: "salesforce",
    label: "Salesforce",
    category: "crm",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("crm.read", "Read leads, contacts, accounts, opportunities, and cases", ["api"], "Provide a redacted Salesforce export."),
      eventCapability("crm.events", "Receive Salesforce change events through Hermes"),
      approvedWriteCapability("crm.approved_write", "Apply an exact fingerprint-approved Salesforce record update", ["api"], "Apply the approved CRM update manually.")
    ],
    notes: ["Salesforce writes remain blocked unless the broker grants approved execution and the exact action fingerprint is approved."]
  }),
  manifest({
    id: "stripe",
    label: "Stripe",
    category: "billing",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("billing.read", "Read customers, subscriptions, invoices, payments, and disputes", ["read_only"], "Provide a redacted Stripe export."),
      eventCapability("billing.events", "Receive verified Stripe events through Hermes"),
      approvedWriteCapability("billing.approved_write", "Apply an exact fingerprint-approved billing action", [], "Apply the approved billing action manually.")
    ],
    notes: ["Financial mutations require a separate broker action capability and fingerprint-bound human approval."]
  }),
  manifest({
    id: "zendesk",
    label: "Zendesk",
    category: "support",
    transport: "http_api",
    authType: "api_key",
    capabilities: [
      readCapability("support.read", "Read bounded ticket, requester, priority, and satisfaction evidence", [], "Provide a redacted Zendesk export."),
      eventCapability("support.events", "Receive verified Zendesk ticket events through Hermes"),
      draftCapability("support.draft_write", "Prepare a support reply draft without sending it", [], "Create the draft in a local review artifact.")
    ],
    notes: ["Use a dedicated least-privilege integration identity; customer replies stay review-gated."]
  }),
  manifest({
    id: "intercom",
    label: "Intercom",
    category: "support",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("support.read", "Read bounded conversations, contacts, and support evidence", ["read_conversations"], "Provide a redacted Intercom export."),
      eventCapability("support.events", "Receive verified Intercom conversation events through Hermes"),
      draftCapability("support.draft_write", "Prepare a conversation reply draft without sending it", [], "Create the draft in a local review artifact.")
    ],
    notes: ["Customer-facing replies stay as prepared drafts until an accountable owner approves them."]
  }),
  manifest({
    id: "workday",
    label: "Workday",
    category: "hris",
    transport: "http_api",
    authType: "provider_app",
    capabilities: [
      readCapability("hris.read", "Read bounded worker, job, and onboarding evidence", [], "Provide a redacted Workday report."),
      eventCapability("hris.events", "Receive verified Workday worker events through Hermes")
    ],
    notes: ["Protected attributes must be excluded from routing and model context unless explicitly required and approved."]
  }),
  manifest({
    id: "greenhouse",
    label: "Greenhouse",
    category: "ats",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("ats.read", "Read bounded candidate, application, job, and stage evidence", ["candidates:read"], "Provide a redacted Greenhouse export."),
      eventCapability("ats.events", "Receive verified Greenhouse recruiting events through Hermes")
    ],
    notes: ["Candidate data is restricted; protected attributes are excluded from default field mappings."]
  }),
  manifest({
    id: "netsuite",
    label: "NetSuite",
    category: "finance",
    transport: "http_api",
    authType: "provider_app",
    capabilities: [
      readCapability("finance.read", "Read bounded ledger, receivable, vendor, approval, and forecast evidence", [], "Provide a redacted NetSuite export."),
      eventCapability("finance.events", "Receive verified NetSuite finance events through Hermes"),
      approvedWriteCapability("finance.approved_write", "Apply an exact fingerprint-approved finance record update", [], "Apply the approved record update manually.")
    ],
    notes: ["Finance writes require approved execution authority and remain fingerprint-bound."]
  }),
  manifest({
    id: "quickbooks",
    label: "QuickBooks",
    category: "finance",
    transport: "http_api",
    authType: "provider_app",
    capabilities: [
      readCapability("finance.read", "Read bounded accounting, receivable, vendor, and cash evidence", ["com.intuit.quickbooks.accounting"], "Provide a redacted QuickBooks export."),
      eventCapability("finance.events", "Receive verified QuickBooks accounting events through Hermes"),
      approvedWriteCapability("finance.approved_write", "Apply an exact fingerprint-approved accounting record update", ["com.intuit.quickbooks.accounting"], "Apply the approved accounting update manually.")
    ],
    notes: ["Accounting writes require approved execution authority and remain fingerprint-bound."]
  }),
  manifest({
    id: "gmail",
    label: "Gmail",
    category: "email",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("mail.thread.read", "Read a bounded Gmail thread and metadata", ["https://www.googleapis.com/auth/gmail.readonly"], "Provide a redacted email-thread export."),
      draftCapability("mail.message.draft", "Prepare an email draft without sending it", ["https://www.googleapis.com/auth/gmail.compose"], "Create the draft in a local review artifact."),
      approvedWriteCapability("mail.message.send", "Send an exact fingerprint-approved email", ["https://www.googleapis.com/auth/gmail.send"], "Send the approved email manually.")
    ],
    notes: ["Gmail read and compose scopes are restricted Google scopes; deployments must complete the applicable verification and security-assessment requirements."]
  }),
  manifest({
    id: "google_calendar",
    label: "Google Calendar",
    category: "calendar",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("calendar.event.read", "Read bounded calendar commitments", ["https://www.googleapis.com/auth/calendar.events.readonly"], "Provide a redacted calendar export.")
    ],
    notes: ["The default connector is read-only and returns only the configured event window."]
  }),
  manifest({
    id: "outlook",
    label: "Microsoft Outlook",
    category: "email",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("mail.thread.read", "Read a bounded Outlook conversation", ["Mail.Read"], "Provide a redacted conversation export."),
      readCapability("calendar.event.read", "Read bounded Outlook calendar commitments", ["Calendars.Read"], "Provide a redacted calendar export."),
      draftCapability("mail.message.draft", "Prepare an Outlook email draft without sending it", ["Mail.ReadWrite"], "Create the draft in a local review artifact."),
      approvedWriteCapability("mail.message.send", "Send an exact fingerprint-approved Outlook email", ["Mail.Send"], "Send the approved email manually.")
    ],
    notes: ["Delegated permissions are requested per connected user; sending remains separately approval-gated."]
  }),
  manifest({
    id: "teams",
    label: "Microsoft Teams",
    category: "messaging",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      draftCapability("collaboration.message.draft", "Prepare a Teams message without posting it", ["ChannelMessage.Send"], "Create the draft in a local review artifact."),
      approvedWriteCapability("messaging.channel.post", "Post an exact fingerprint-approved Teams message", ["ChannelMessage.Send"], "Post the approved message manually.")
    ],
    notes: ["Channel posting remains blocked until the exact prepared message fingerprint and destination are approved."]
  }),
  manifest({
    id: "posthog",
    label: "PostHog",
    category: "analytics",
    transport: "http_api",
    authType: "api_key",
    capabilities: [
      readCapability("analytics.event.query", "Read a bounded saved PostHog insight", ["query:read"], "Provide a redacted PostHog insight export.")
    ],
    notes: ["The connector reads saved insight IDs; it does not expose arbitrary HogQL or an HTTP proxy."]
  }),
  manifest({
    id: "amplitude",
    label: "Amplitude",
    category: "analytics",
    transport: "http_api",
    authType: "api_key",
    capabilities: [
      readCapability("analytics.event.query", "Run a bounded Amplitude event-segmentation query", ["analytics:read"], "Provide a redacted Amplitude chart export.")
    ],
    notes: ["The connector uses project-scoped API and secret keys and a fixed event-segmentation endpoint."]
  }),
  manifest({
    id: "linear",
    label: "Linear",
    category: "issue_tracker",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("project.issue.read", "Read a bounded Linear issue", ["read"], "Provide a redacted Linear issue export."),
      readCapability("incident.record.read", "Read a bounded incident record represented in Linear", ["read"], "Provide a redacted incident export."),
      readCapability("product.release.read", "Read a bounded Linear project and release state", ["read"], "Provide a redacted Linear project export."),
      approvedWriteCapability("project.issue.create", "Create an exact fingerprint-approved Linear issue", ["write"], "Create the approved issue manually."),
      approvedWriteCapability("project.issue.update", "Apply an exact fingerprint-approved Linear issue update", ["write"], "Apply the approved issue update manually."),
      eventCapability("issue_tracker.events", "Receive signed issue, project, and comment events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["linear*"],
      eventTypePatterns: ["Issue.*", "Comment.*", "Project.*", "OAuthApp.*"],
      subscription: "The Linear OAuth app installs organization webhooks that terminate at Hermes.",
      signature: "Linear-Signature HMAC-SHA256 over the raw body plus a fresh webhook timestamp",
      routeNameTemplate: "loopgraph-linear-events",
      filterHints: ["Allow only issues, incidents, projects, and comments claimed by installed loops.", "Treat titles, descriptions, and comments as untrusted text."],
      transformVersion: "linear-event-envelope/v1",
      stableDeliveryId: "SHA-256 of the Linear-signed raw body",
      subjectIdPath: "data.id",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["Issue.create", "Issue.update", "Project.update"]
    },
    notes: ["Default consent is read-only. Issue creates and updates require scope escalation plus an exact fingerprint and human approval."]
  }),
  manifest({
    id: "jira",
    label: "Jira Cloud",
    category: "issue_tracker",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("project.issue.read", "Read a bounded Jira issue", ["read:jira-work"], "Provide a redacted Jira issue export."),
      readCapability("incident.record.read", "Read a bounded Jira incident record", ["read:jira-work"], "Provide a redacted incident export."),
      readCapability("product.release.read", "Read bounded Jira project versions", ["read:jira-work"], "Provide a redacted project-version export."),
      approvedWriteCapability("project.issue.create", "Create an exact fingerprint-approved Jira issue", ["write:jira-work"], "Create the approved issue manually."),
      approvedWriteCapability("project.issue.update", "Apply an exact fingerprint-approved Jira issue update", ["write:jira-work"], "Apply the approved issue update manually."),
      eventCapability("issue_tracker.events", "Receive authenticated Jira issue and version events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["jira*", "atlassian*"],
      eventTypePatterns: ["jira:issue_*", "jira:version_*"],
      subscription: "Hermes dynamically registers renewable Jira Cloud webhooks through the 3LO installation.",
      signature: "Atlassian OAuth webhook bearer JWT signed with the app client secret",
      routeNameTemplate: "loopgraph-jira-events",
      filterHints: ["Use narrow JQL during subscription; never accept caller-provided JQL through a capability operation.", "Treat summaries, descriptions, and comments as untrusted text."],
      transformVersion: "jira-cloud-event-envelope/v1",
      stableDeliveryId: "Installation-bound callback authenticator plus JWT identity and payload hash",
      subjectIdPath: "issue.key or version.id",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["jira:issue_created", "jira:issue_updated", "jira:version_released"]
    },
    notes: ["All API calls use api.atlassian.com/ex/jira/{cloudId}; a user-controlled site URL or arbitrary JQL is never accepted."]
  }),
  manifest({
    id: "gitlab",
    label: "GitLab.com",
    category: "repository",
    transport: "http_api",
    authType: "oauth2",
    capabilities: [
      readCapability("repo.issue.read", "Read a bounded GitLab issue", ["read_api"], "Provide a redacted GitLab issue export."),
      readCapability("deployment.release.read", "Read bounded GitLab deployment evidence", ["read_api"], "Provide a redacted GitLab deployment export."),
      eventCapability("repository.events", "Receive signed GitLab issue, deployment, and release events through Hermes")
    ],
    webhook: {
      sourcePatterns: ["gitlab*"],
      eventTypePatterns: ["Issue Hook", "Deployment Hook", "Release Hook"],
      subscription: "GitLab.com project or group webhooks terminate at Hermes.",
      signature: "GitLab Standard Webhooks HMAC signing token; legacy X-Gitlab-Token is migration-only",
      routeNameTemplate: "loopgraph-gitlab-events",
      filterHints: ["Allow issue, deployment, and release events needed by active routes only.", "Treat issue titles, descriptions, comments, refs, and release notes as untrusted text."],
      transformVersion: "gitlab-event-envelope/v1",
      stableDeliveryId: "webhook-id or Idempotency-Key",
      subjectIdPath: "object_attributes.id",
      maxPayloadKb: 256,
      burstLimitPerMinute: 120,
      exampleEventTypes: ["Issue Hook", "Deployment Hook", "Release Hook"]
    },
    notes: ["The built-in adapter is pinned to GitLab.com. Self-managed hosts require an explicitly reviewed custom connector and hostname policy."]
  }),
  manifest({
    id: "manual_file",
    label: "Manual File Import",
    category: "manual",
    transport: "file_import",
    authType: "manual",
    capabilities: [
      readCapability("ads.read", "Read redacted ads exports", [], "Upload or reference a redacted ads CSV/JSON export."),
      readCapability("analytics.read", "Read redacted analytics exports", [], "Upload or reference a redacted analytics CSV/JSON export."),
      readCapability("crm.read", "Read redacted CRM exports", [], "Upload or reference a redacted CRM CSV/JSON export."),
      readCapability("repository.read", "Read redacted repository context", [], "Upload or reference a redacted repository policy/manifest export."),
      readCapability("issue_tracker.read", "Read redacted issue tracker context", [], "Upload or reference a redacted issue JSON export."),
      readCapability("content_repository.read", "Read approved local briefs and evidence", [], "Upload or reference a local Markdown/JSON folder."),
      draftCapability("issue_tracker.draft_write", "Write local issue action drafts", [], "Use local draft issue actions only."),
      approvedWriteCapability("issue_tracker.approved_write", "Manually apply approved issue actions", [], "Apply approved labels or comments manually."),
      draftCapability("content_repository.draft_write", "Write local draft files", [], "Use local draft files only."),
      draftCapability("cms.draft", "Prepare local CMS draft payloads", [], "Use local draft JSON only."),
      draftCapability("messaging.notify", "Prepare local notification payloads", [], "Use local/log notifications only.")
    ],
    notes: ["Manual file import is the default simulation fallback and does not imply live provider access."]
  })
];

export function defaultConnectorManifests(): ConnectorManifest[] {
  return DEFAULT_CONNECTOR_MANIFESTS;
}

export function manifestsForCapability(capability: string, manifests = DEFAULT_CONNECTOR_MANIFESTS): ConnectorManifest[] {
  return manifests.filter((manifest) =>
    manifest.capabilities.some((candidate) => candidate.key === capability)
  );
}

export function capabilityForManifest(manifest: ConnectorManifest, capability: string): ConnectorCapability | undefined {
  return manifest.capabilities.find((candidate) => candidate.key === capability);
}

export async function readConnectionInstances(projectRoot: string): Promise<ConnectionInstance[]> {
  const filePath = connectionInstancesFilePath(projectRoot);
  try {
    const parsed = connectionInstancesFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    return parsed.instances;
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw error;
  }
}

export function connectionInstanceFromBrokerInstallation(
  installation: ConnectorInstallationView,
  manifests: ConnectorManifest[] = DEFAULT_CONNECTOR_MANIFESTS
): ConnectionInstance {
  const connector = manifests.find((candidate) => candidate.id === installation.providerId);
  if (!connector) throw new Error(`No App Platform connector manifest exists for broker provider: ${installation.providerId}`);
  const allowed = new Set(installation.allowedCapabilities);
  const canRead = allowed.has("provider.data.read");
  const canDraft = allowed.has("provider.draft.write");
  const canExecute = allowed.has("provider.action.execute");
  const canReceiveEvents = allowed.has("provider.webhooks.verify") || allowed.has("provider.webhooks.subscribe");
  const capabilityKeys = connector.capabilities
    .filter((capability) => {
      if (capability.direction === "read") return canRead;
      if (capability.direction === "event") return canReceiveEvents;
      if (capability.direction === "draft_write") return canDraft;
      return canExecute;
    })
    .map((capability) => capability.key);
  const status = brokerConnectionStatus(installation.status);
  const healthStatus = status === "connected" ? "connected" : status === "degraded" ? "degraded" : "missing";
  return connectionInstanceSchema.parse({
    schemaVersion: CONNECTION_INSTANCE_SCHEMA_VERSION,
    id: installation.id,
    manifestId: installation.providerId,
    source: "hermes_connector_broker",
    externalInstallationId: installation.id,
    brokerCapabilities: installation.allowedCapabilities,
    accountLabel: installation.displayName,
    capabilityKeys,
    grantedScopes: installation.grantedScopes,
    status,
    statusReason: status === "connected" ? undefined : `Hermes Connector Broker installation is ${installation.status}.`,
    environment: installation.environment === "production" ? "live" : "sandbox",
    readPolicy: canRead ? "read_only" : "not_allowed",
    writePolicy: canExecute ? "approved_only" : canDraft ? "draft_only" : "not_allowed",
    lastHealthCheckAt: installation.lastHealthCheckAt,
    health: installation.lastHealthCheckAt ? {
      status: healthStatus,
      checkedAt: installation.lastHealthCheckAt,
      checkedBy: "hermes_connector_broker",
      evidenceRefs: [`broker-installation:${installation.id}`]
    } : undefined
  });
}

export function mergeConnectionInstances(
  local: ConnectionInstance[],
  projected: ConnectionInstance[]
): ConnectionInstance[] {
  const byId = new Map(local.map((connection) => [connection.id, connection]));
  for (const connection of projected) byId.set(connection.id, connection);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function brokerConnectionStatus(status: ConnectorInstallationView["status"]): ConnectionInstance["status"] {
  if (status === "active" || status === "connected") return "connected";
  if (status === "degraded" || status === "subscription_pending" || status === "rotating") return "degraded";
  return "missing";
}

export async function upsertConnectionInstance(
  projectRoot: string,
  input: Omit<ConnectionInstance, "schemaVersion" | "source" | "brokerCapabilities"> &
    Partial<Pick<ConnectionInstance, "source" | "brokerCapabilities">>
): Promise<ConnectionInstance> {
  const manifest = defaultConnectorManifests().find((candidate) => candidate.id === input.manifestId);
  if (!manifest) throw new Error(`Unknown connector manifest: ${input.manifestId}`);
  const knownCapabilities = new Set(manifest.capabilities.map((capability) => capability.key));
  const unknownCapabilities = input.capabilityKeys.filter((capability) => !knownCapabilities.has(capability));
  if (unknownCapabilities.length > 0) {
    throw new Error(`Connection declares capabilities not supported by ${manifest.id}: ${unknownCapabilities.join(", ")}`);
  }
  const instance = connectionInstanceSchema.parse({
    ...input,
    schemaVersion: CONNECTION_INSTANCE_SCHEMA_VERSION
  });
  return withConnectionInstancesLock(projectRoot, async () => {
    const instances = await readConnectionInstances(projectRoot);
    const next = [
      ...instances.filter((candidate) => candidate.id !== instance.id),
      instance
    ].sort((left, right) => left.id.localeCompare(right.id));
    await writeConnectionInstances(projectRoot, next);
    return instance;
  });
}

export async function reportConnectionInstanceHealth(input: {
  projectRoot: string;
  instanceId: string;
  status: "connected" | "degraded" | "missing";
  checkedAt: string;
  checkedBy: string;
  latencyMs?: number;
  errorCode?: string;
  evidenceRefs?: string[];
}): Promise<ConnectionInstance> {
  return withConnectionInstancesLock(input.projectRoot, async () => {
    const instances = await readConnectionInstances(input.projectRoot);
    const current = instances.find((candidate) => candidate.id === input.instanceId);
    if (!current) throw new Error(`Connection instance not found: ${input.instanceId}`);
    const next = connectionInstanceSchema.parse({
      ...current,
      status: input.status,
      statusReason: input.errorCode,
      lastHealthCheckAt: input.checkedAt,
      health: {
        status: input.status,
        checkedAt: input.checkedAt,
        checkedBy: input.checkedBy,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
        evidenceRefs: [...new Set(input.evidenceRefs ?? [])]
      }
    });
    await writeConnectionInstances(input.projectRoot, [
      ...instances.filter((candidate) => candidate.id !== next.id),
      next
    ].sort((left, right) => left.id.localeCompare(right.id)));
    return next;
  });
}

export async function writeConnectionInstances(
  projectRoot: string,
  instances: ConnectionInstance[]
): Promise<void> {
  const filePath = connectionInstancesFilePath(projectRoot);
  const value = connectionInstancesFileSchema.parse({
    schemaVersion: CONNECTION_INSTANCE_SCHEMA_VERSION,
    instances
  });
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export function connectionInstancesFilePath(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "connections", "instances.json");
}

async function withConnectionInstancesLock<T>(
  projectRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const directory = path.dirname(connectionInstancesFilePath(projectRoot));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, ".instances.lock");
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString()
      }));
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (await isStaleLock(lockPath, 60_000)) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= 5_000) {
        throw new Error("Timed out waiting for connection instance lock");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}

function manifest(input: Omit<ConnectorManifest, "schemaVersion" | "healthCheck"> & {
  healthCheck?: ConnectorManifest["healthCheck"];
}): ConnectorManifest {
  return connectorManifestSchema.parse({
    schemaVersion: "connector-manifest/v1alpha1",
    healthCheck: { mode: "manual" },
    ...input
  });
}

function readCapability(
  key: string,
  label: string,
  minimumScopes: string[],
  manualFallback: string
): ConnectorCapability {
  return {
    key,
    label,
    direction: "read",
    minimumScopes,
    riskLevel: "low",
    manualFallback
  };
}

function eventCapability(key: string, label: string): ConnectorCapability {
  return {
    key,
    label,
    direction: "event",
    minimumScopes: [],
    riskLevel: "low"
  };
}

function draftCapability(
  key: string,
  label: string,
  minimumScopes: string[],
  manualFallback: string
): ConnectorCapability {
  return {
    key,
    label,
    direction: "draft_write",
    minimumScopes,
    riskLevel: "medium",
    manualFallback
  };
}

function approvedWriteCapability(
  key: string,
  label: string,
  minimumScopes: string[],
  manualFallback: string
): ConnectorCapability {
  return {
    key,
    label,
    direction: "approved_write",
    minimumScopes,
    riskLevel: "medium",
    manualFallback
  };
}
