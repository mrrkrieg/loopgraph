import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CONNECTION_INSTANCE_SCHEMA_VERSION,
  connectionInstancesFileSchema,
  connectorManifestSchema,
  type ConnectionInstance,
  type ConnectorCapability,
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
  } catch {
    return [];
  }
}

export function connectionInstancesFilePath(projectRoot: string): string {
  return path.join(getLoopgraphRoot(projectRoot), "connections", "instances.json");
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
