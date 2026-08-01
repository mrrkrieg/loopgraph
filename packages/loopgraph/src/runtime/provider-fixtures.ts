import type { ProviderId } from "../core";

export type ProviderGoldenFixture = {
  providerId: ProviderId;
  deliveryId: string;
  payload: Record<string, unknown>;
  expectedEventType: string;
  expectedSubjectType: string;
};

// Redacted, synthetic provider-shaped payloads. These are deliberately small:
// they exercise normalization contracts without checking customer data into Git.
export const PROVIDER_GOLDEN_FIXTURES: ProviderGoldenFixture[] = [
  { providerId: "hubspot", deliveryId: "hubspot-1", payload: { objectId: 101, subscriptionType: "company.propertyChange", propertyName: "lifecyclestage", propertyValue: "customer" }, expectedEventType: "company.propertyChange", expectedSubjectType: "account" },
  { providerId: "google_ads", deliveryId: "google-ads-1", payload: { eventType: "campaign.performance_anomaly", campaign: { id: "2001" }, metrics: { costMicros: 51000000, conversions: 2 } }, expectedEventType: "campaign.performance_anomaly", expectedSubjectType: "campaign" },
  { providerId: "slack", deliveryId: "slack-1", payload: { event_id: "Ev01", event: { type: "app_mention", channel: "C01", text: "synthetic escalation" } }, expectedEventType: "app_mention", expectedSubjectType: "conversation" },
  { providerId: "notion", deliveryId: "notion-1", payload: { id: "evt-notion-1", type: "page.content_updated", entity: { id: "page-1" } }, expectedEventType: "page.content_updated", expectedSubjectType: "document" },
  { providerId: "salesforce", deliveryId: "salesforce-1", payload: { eventType: "OpportunityChangeEvent", objectType: "Opportunity", recordId: "0060001" }, expectedEventType: "OpportunityChangeEvent", expectedSubjectType: "deal" },
  { providerId: "stripe", deliveryId: "stripe-1", payload: { id: "evt_stripe_1", type: "invoice.payment_failed", data: { object: { id: "in_1", object: "invoice" } } }, expectedEventType: "invoice.payment_failed", expectedSubjectType: "invoice" },
  { providerId: "github", deliveryId: "github-1", payload: { action: "opened", issue: { number: 42, title: "Synthetic incident" }, repository: { full_name: "example/repo" } }, expectedEventType: "issue.opened", expectedSubjectType: "issue" },
  { providerId: "zendesk", deliveryId: "zendesk-1", payload: { id: "zd-1", type: "ticket.updated", ticket: { id: 77, description: "synthetic complaint" } }, expectedEventType: "ticket.updated", expectedSubjectType: "support_ticket" },
  { providerId: "intercom", deliveryId: "intercom-1", payload: { id: "ic-1", type: "conversation.user.created", conversation: { id: "conv-1" } }, expectedEventType: "conversation.user.created", expectedSubjectType: "support_ticket" },
  { providerId: "workday", deliveryId: "workday-1", payload: { id: "wd-1", type: "worker.changed", employeeId: "worker-1" }, expectedEventType: "worker.changed", expectedSubjectType: "employee" },
  { providerId: "greenhouse", deliveryId: "greenhouse-1", payload: { id: "gh-hr-1", type: "candidate.stage_changed", candidateId: "candidate-1" }, expectedEventType: "candidate.stage_changed", expectedSubjectType: "candidate" },
  { providerId: "netsuite", deliveryId: "netsuite-1", payload: { id: "ns-1", type: "invoice.changed", invoiceId: "invoice-1" }, expectedEventType: "invoice.changed", expectedSubjectType: "invoice" },
  { providerId: "quickbooks", deliveryId: "quickbooks-1", payload: { id: "qb-1", type: "payment.updated", accountId: "account-1" }, expectedEventType: "payment.updated", expectedSubjectType: "account" }
];
