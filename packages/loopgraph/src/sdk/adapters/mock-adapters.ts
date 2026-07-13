import type { IntegrationAdapter } from "../adapters";
import { contentHash } from "../../core/hash";

function createMockAdapter(config: {
  id: string;
  name: string;
  variables: Array<{ key: string; path: string; label: string; trusted?: boolean }>;
  actions: Array<{ key: string; label: string; writeCapable?: boolean; riskLevel?: "low" | "medium" | "high" | "critical"; customerFacing?: boolean }>;
}): IntegrationAdapter {
  return {
    id: config.id,
    name: config.name,
    version: "1.0.0",
    getConfigSchema: () => ({ type: "object", properties: {} }),
    getAuthSchema: () => ({ type: "object", properties: {} }),
    listVariables: () =>
      config.variables.map((variable) => ({
        key: variable.key,
        label: variable.label,
        description: variable.label,
        type: "string",
        sensitivity: "internal"
      })),
    listActions: () =>
      config.actions.map((action) => ({
        key: action.key,
        label: action.label,
        description: action.label,
        writeCapable: action.writeCapable ?? true,
        riskLevel: action.riskLevel ?? "medium"
      })),
    listSignals: () => [],
    async readVariable(key, fixture) {
      const variable = config.variables.find((item) => item.key === key);
      const value = variable ? getByPath(fixture, variable.path) : undefined;
      return {
        key,
        value,
        retrievedAt: String(fixture.simulatedAt ?? new Date(0).toISOString()),
        freshness: "fixture",
        trusted: variable?.trusted ?? false
      };
    },
    async prepareAction(input) {
      const action = config.actions.find((item) => item.key === input.toolKey);
      return {
        id: `prepared_${input.toolKey}`,
        toolKey: input.toolKey,
        label: action?.label ?? input.toolKey,
        payload: input.payload,
        fingerprint: contentHash(input.payload),
        riskLevel: action?.riskLevel ?? "medium",
        requiresApproval: (action?.riskLevel ?? "medium") !== "low",
        customerFacing: action?.customerFacing ?? false
      };
    },
    async commitPreparedAction(input) {
      const approved = input.approvedFingerprints.includes(input.preparedAction.fingerprint);
      return {
        status: approved ? "mock_committed" : "rejected",
        message: approved ? "Mock commit recorded" : "Fingerprint mismatch",
        fingerprint: input.preparedAction.fingerprint
      };
    },
    async healthCheck() {
      return { ok: true, message: `${config.name} healthy` };
    }
  };
}

function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export const mockGithubAdapter = createMockAdapter({
  id: "mock-github",
  name: "Mock GitHub",
  variables: [
    { key: "issue.title", path: "issue.title", label: "Issue title", trusted: false },
    { key: "issue.body", path: "issue.body", label: "Issue body", trusted: false },
    { key: "issue.labels", path: "issue.labels", label: "Issue labels", trusted: true },
    { key: "repo.policy", path: "repo.policy", label: "Repository policy", trusted: true }
  ],
  actions: [
    { key: "propose_labels", label: "Propose labels", riskLevel: "medium" },
    { key: "draft_response", label: "Draft response", riskLevel: "low" },
    { key: "create_follow_up", label: "Create follow-up task", riskLevel: "low" },
    { key: "create_escalation_case", label: "Create escalation case", riskLevel: "high" }
  ]
});

export const mockSupportAdapter = createMockAdapter({
  id: "mock-support",
  name: "Mock Support",
  variables: [
    { key: "support.ticket.current", path: "ticket.current", label: "Current ticket", trusted: false },
    { key: "support.ticket.history_90d", path: "ticket.history", label: "Ticket history", trusted: true }
  ],
  actions: [
    { key: "draft_internal_reply", label: "Draft internal reply", riskLevel: "low" },
    { key: "customer_message", label: "Customer message", riskLevel: "high", customerFacing: true }
  ]
});

export const mockCrmAdapter = createMockAdapter({
  id: "mock-crm",
  name: "Mock CRM",
  variables: [
    { key: "crm.account", path: "account", label: "Account", trusted: true },
    { key: "account.segment", path: "account.segment", label: "Account segment", trusted: true },
    { key: "account.renewalDaysRemaining", path: "account.renewalDaysRemaining", label: "Renewal days", trusted: true },
    { key: "businessImpact.renewalRisk", path: "businessImpact.renewalRisk", label: "Renewal risk", trusted: true }
  ],
  actions: [{ key: "create_follow_up_task", label: "Create follow-up task", riskLevel: "low" }]
});

export const mockStatusAdapter = createMockAdapter({
  id: "mock-status",
  name: "Mock Status",
  variables: [
    { key: "status.incidents.current", path: "incidents.current", label: "Current incidents", trusted: true },
    { key: "incident.category", path: "incident.category", label: "Incident category", trusted: true },
    { key: "incident.severity", path: "incident.severity", label: "Incident severity", trusted: true }
  ],
  actions: []
});

export const mockProductAnalyticsAdapter = createMockAdapter({
  id: "mock-product-analytics",
  name: "Mock Product Analytics",
  variables: [{ key: "product.usage_30d", path: "usage_30d", label: "Usage 30d", trusted: true }],
  actions: []
});

export const mockLinearAdapter = createMockAdapter({
  id: "mock-linear",
  name: "Mock Linear",
  variables: [],
  actions: [{ key: "create_internal_task", label: "Create internal task", riskLevel: "medium" }]
});

export const localJsonAdapter = createMockAdapter({
  id: "local-json",
  name: "Local JSON",
  variables: [{ key: "fixture.raw", path: ".", label: "Fixture root", trusted: false }],
  actions: []
});

export const webhookAdapter = createMockAdapter({
  id: "webhook",
  name: "Webhook",
  variables: [{ key: "event.raw", path: "trigger", label: "Trigger event", trusted: false }],
  actions: []
});

export const allMockAdapters = [
  mockGithubAdapter,
  mockSupportAdapter,
  mockCrmAdapter,
  mockStatusAdapter,
  mockProductAnalyticsAdapter,
  mockLinearAdapter,
  localJsonAdapter,
  webhookAdapter
];
