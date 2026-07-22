import type { IntegrationAdapter } from "../adapters";
import { contentHash } from "../../core/hash";

type VariableConfig = {
  key: string;
  label: string;
  path: string;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  trusted?: boolean;
};

type ActionConfig = {
  key: string;
  label: string;
  description?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  customerFacing?: boolean;
  writeCapable?: boolean;
};

type LocalFirstAdapterConfig = {
  id: string;
  name: string;
  variables: VariableConfig[];
  signals?: Array<{ key: string; label: string }>;
  actions?: ActionConfig[];
  healthMessage: string;
};

function createLocalFirstAdapter(config: LocalFirstAdapterConfig): IntegrationAdapter {
  return {
    id: config.id,
    name: config.name,
    version: "0.1.0",
    getConfigSchema: () => ({
      type: "object",
      additionalProperties: false,
      properties: {
        fixtureRoot: {
          type: "string",
          description: "Optional project-local folder containing synthetic or redacted fixture exports."
        }
      }
    }),
    getAuthSchema: () => ({
      type: "object",
      additionalProperties: false,
      properties: {
        credentialRef: {
          type: "string",
          description: "Optional opaque credential reference. Never provide raw tokens, secrets, or API keys."
        }
      }
    }),
    listVariables: () => config.variables.map((variable) => ({
      key: variable.key,
      label: variable.label,
      description: variable.label,
      type: "json",
      sensitivity: variable.sensitivity ?? "internal"
    })),
    listActions: () => (config.actions ?? []).map((action) => ({
      key: action.key,
      label: action.label,
      description: action.description ?? action.label,
      writeCapable: action.writeCapable ?? true,
      riskLevel: action.riskLevel ?? "medium"
    })),
    listSignals: () => config.signals ?? [],
    async readVariable(key, fixture) {
      const variable = config.variables.find((item) => item.key === key);
      const value = variable ? getByPath(fixture, variable.path) : undefined;
      return {
        key,
        value,
        retrievedAt: String(fixture.simulatedAt ?? fixture.receivedAt ?? new Date(0).toISOString()),
        freshness: "fixture",
        trusted: variable?.trusted ?? false
      };
    },
    async prepareAction(input) {
      const action = (config.actions ?? []).find((item) => item.key === input.toolKey);
      return {
        id: `prepared_${slugify(config.id)}_${slugify(input.toolKey)}`,
        toolKey: input.toolKey,
        label: action?.label ?? input.toolKey,
        payload: {
          ...input.payload,
          localOnly: true,
          preparedBy: config.id
        },
        fingerprint: contentHash({ adapterId: config.id, toolKey: input.toolKey, payload: input.payload }),
        riskLevel: action?.riskLevel ?? "medium",
        requiresApproval: (action?.riskLevel ?? "medium") !== "low" || Boolean(action?.customerFacing),
        customerFacing: action?.customerFacing ?? false
      };
    },
    async commitPreparedAction(input) {
      const approved = input.approvedFingerprints.includes(input.preparedAction.fingerprint);
      return {
        status: approved ? "mock_committed" : "rejected",
        message: approved
          ? `${config.name} recorded a local, fingerprint-approved simulation result.`
          : `${config.name} rejected the action because its fingerprint was not approved.`,
        fingerprint: input.preparedAction.fingerprint
      };
    },
    async healthCheck() {
      return {
        ok: true,
        message: config.healthMessage
      };
    }
  };
}

export const manualAdapter = createLocalFirstAdapter({
  id: "manual",
  name: "Manual Review",
  healthMessage: "Manual review adapter is available for local simulation and approved human handoff.",
  variables: [
    { key: "manual.context", label: "Manual context", path: ".", trusted: false },
    { key: "manual.evidence_refs", label: "Manual evidence references", path: "evidenceRefs", trusted: true }
  ],
  actions: [
    { key: "draft_review", label: "Draft review packet", riskLevel: "low", writeCapable: false },
    { key: "create_review_task", label: "Create local review task", riskLevel: "low" },
    { key: "create_escalation_case", label: "Create local escalation case", riskLevel: "high" }
  ]
});

export const manualFileAdapter = createLocalFirstAdapter({
  id: "manual_file",
  name: "Manual File Import",
  healthMessage: "Manual file adapter reads synthetic or redacted local fixture exports only.",
  variables: [
    { key: "manual_file.raw", label: "Raw local fixture", path: ".", trusted: false },
    { key: "manual_file.normalized_payload", label: "Normalized payload", path: "normalizedPayload", trusted: true },
    { key: "manual_file.subject", label: "Event subject", path: "subject", trusted: true }
  ],
  actions: [
    { key: "write_local_draft", label: "Write local draft payload", riskLevel: "low" },
    { key: "record_manual_follow_up", label: "Record manual follow-up", riskLevel: "low" }
  ]
});

export const googleAdsAdapter = createLocalFirstAdapter({
  id: "google_ads",
  name: "Google Ads Fixture Reader",
  healthMessage: "Google Ads adapter is in fixture/manual-export mode; no live Ads account is connected.",
  variables: [
    { key: "ads.campaign", label: "Campaign", path: "normalizedPayload.campaign", trusted: true },
    { key: "ads.signals", label: "Campaign signals", path: "normalizedPayload.signals", trusted: true },
    { key: "ads.spend", label: "Spend signal", path: "normalizedPayload.signals.spend", trusted: true }
  ],
  signals: [
    { key: "campaign.performance_anomaly", label: "Campaign performance anomaly" },
    { key: "campaign.budget_alert", label: "Campaign budget alert" }
  ],
  actions: [
    { key: "draft_experiment_brief", label: "Draft experiment brief", riskLevel: "low", writeCapable: false },
    { key: "draft_budget_recommendation", label: "Draft budget recommendation", riskLevel: "medium", writeCapable: false }
  ]
});

export const productAnalyticsAdapter = createLocalFirstAdapter({
  id: "product_analytics",
  name: "Product Analytics Fixture Reader",
  healthMessage: "Product analytics adapter reads synthetic or redacted metric fixtures only.",
  variables: [
    { key: "analytics.funnel", label: "Funnel metrics", path: "normalizedPayload.funnel", trusted: true },
    { key: "analytics.conversion", label: "Conversion signal", path: "normalizedPayload.signals.conversion", trusted: true },
    { key: "analytics.guardrails", label: "Guardrail metrics", path: "normalizedPayload.guardrails", trusted: true }
  ],
  signals: [
    { key: "page.conversion_drop", label: "Page conversion drop" },
    { key: "metric.threshold_crossed", label: "Metric threshold crossed" }
  ]
});

export const hubspotAdapter = createLocalFirstAdapter({
  id: "hubspot",
  name: "HubSpot Fixture Reader",
  healthMessage: "HubSpot adapter reads synthetic or redacted CRM fixtures only.",
  variables: [
    { key: "crm.contact", label: "Contact", path: "normalizedPayload.contact", trusted: true },
    { key: "crm.deal", label: "Deal", path: "normalizedPayload.deal", trusted: true },
    { key: "crm.qualified_status", label: "Qualified status", path: "normalizedPayload.qualifiedStatus", trusted: true }
  ],
  signals: [
    { key: "deal.propertyChange", label: "Deal property change" },
    { key: "contact.propertyChange", label: "Contact property change" }
  ],
  actions: [
    { key: "draft_crm_update", label: "Draft CRM update", riskLevel: "medium", writeCapable: false }
  ]
});

export const notionAdapter = createLocalFirstAdapter({
  id: "notion",
  name: "Notion Content Fixture Adapter",
  healthMessage: "Notion adapter is in fixture/local-draft mode; no live workspace is connected.",
  variables: [
    { key: "content.brief", label: "Approved content brief", path: "normalizedPayload.brief", trusted: true },
    { key: "content.evidence", label: "Approved evidence", path: "normalizedPayload.evidence", trusted: true },
    { key: "content.calendar", label: "Content calendar", path: "normalizedPayload.calendar", trusted: true }
  ],
  signals: [
    { key: "content.brief_approved", label: "Content brief approved" }
  ],
  actions: [
    { key: "draft_content_brief", label: "Draft content brief", riskLevel: "low" },
    { key: "draft_content_piece", label: "Draft content piece", riskLevel: "medium", customerFacing: true }
  ]
});

export const localMarkdownAdapter = createLocalFirstAdapter({
  id: "local_markdown",
  name: "Local Markdown Draft Adapter",
  healthMessage: "Local Markdown adapter prepares local drafts for review only.",
  variables: [
    { key: "markdown.sources", label: "Approved Markdown sources", path: "normalizedPayload.sources", trusted: true },
    { key: "markdown.backlog", label: "Content backlog", path: "normalizedPayload.backlog", trusted: true }
  ],
  actions: [
    { key: "write_markdown_draft", label: "Write Markdown draft", riskLevel: "medium", customerFacing: true },
    { key: "write_outline", label: "Write local outline", riskLevel: "low" }
  ]
});

export const webflowAdapter = createLocalFirstAdapter({
  id: "webflow",
  name: "Webflow CMS Draft Adapter",
  healthMessage: "Webflow adapter prepares local CMS draft payloads only; publishing is not enabled.",
  variables: [
    { key: "cms.collection", label: "CMS collection", path: "normalizedPayload.cmsCollection", trusted: true }
  ],
  actions: [
    { key: "prepare_cms_draft", label: "Prepare CMS draft", riskLevel: "medium", customerFacing: true }
  ]
});

export const slackAdapter = createLocalFirstAdapter({
  id: "slack",
  name: "Slack Notification Draft Adapter",
  healthMessage: "Slack adapter prepares local notification payloads only until a messaging channel is approved.",
  variables: [
    { key: "messaging.owner", label: "Message owner", path: "normalizedPayload.owner", trusted: true }
  ],
  actions: [
    { key: "prepare_review_notification", label: "Prepare review notification", riskLevel: "low" }
  ]
});

export const marketingMvpAdapters = [
  manualAdapter,
  manualFileAdapter,
  googleAdsAdapter,
  productAnalyticsAdapter,
  hubspotAdapter,
  notionAdapter,
  localMarkdownAdapter,
  webflowAdapter,
  slackAdapter
];

function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  if (dotPath === ".") return obj;
  return dotPath.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "adapter";
}
