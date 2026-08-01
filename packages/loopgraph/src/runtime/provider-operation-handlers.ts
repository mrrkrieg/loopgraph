import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProviderId } from "../core";
import { ConnectorBrokerError, operationKey, type ConnectorOperationHandler } from "./connector-broker";

export function createProviderOperationHandlers(fetcher: typeof fetch = fetch) {
  const handlers = new Map<string, ConnectorOperationHandler>();
  for (const providerId of [
    "hubspot", "google_ads", "slack", "notion", "salesforce", "stripe", "github",
    "zendesk", "intercom", "workday", "greenhouse", "netsuite", "quickbooks"
  ] satisfies ProviderId[]) {
    handlers.set(operationKey(providerId, "health.check"), async (context) => {
      const lease = await context.getCredential();
      let credential: StoredCredential;
      try {
        credential = parseCredential(lease.reveal());
      } finally {
        lease.dispose();
      }
      const probe = healthProbe(providerId, credential);
      if (!probe) {
        return {
          status: "credential_resolvable",
          providerReachable: null,
          checkedAt: new Date().toISOString()
        };
      }
      const response = await fetcher(probe.url, {
        method: probe.method ?? "GET",
        headers: probe.headers,
        body: probe.body,
        redirect: "error",
        signal: AbortSignal.timeout(10_000)
      });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectorBrokerError("provider_credential_rejected", "Provider rejected the credential.", false);
      }
      if (!response.ok) {
        throw new ConnectorBrokerError("provider_health_unavailable", `Provider health check failed (${response.status}).`, response.status >= 500);
      }
      const accountId = response.headers.get("x-account-id") ?? response.headers.get("stripe-account");
      return {
        status: "connected",
        providerReachable: true,
        checkedAt: new Date().toISOString(),
        ...(accountId ? { accountFingerprint: createHash("sha256").update(accountId).digest("hex").slice(0, 16) } : {})
      };
    });
  }
  registerHubSpotHandlers(handlers, fetcher);
  registerGoogleAdsHandlers(handlers, fetcher);
  registerSlackHandlers(handlers, fetcher);
  registerNotionHandlers(handlers, fetcher);
  registerSalesforceHandlers(handlers, fetcher);
  registerGitHubHandlers(handlers, fetcher);
  registerStripeHandlers(handlers, fetcher);
  registerSupportHandlers(handlers, fetcher);
  registerHrisHandlers(handlers, fetcher);
  registerFinanceHandlers(handlers, fetcher);
  return handlers;
}

function registerHubSpotHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  const objectInput = z.object({ objectId: safeProviderId }).strict();
  for (const [operation, objectType, properties] of [
    ["crm.companies.read", "companies", ["name", "domain", "industry", "lifecyclestage"]],
    ["crm.contacts.read", "contacts", ["firstname", "lastname", "email", "company", "lifecyclestage"]],
    ["crm.deals.read", "deals", ["dealname", "amount", "dealstage", "pipeline", "closedate"]]
  ] as const) {
    handlers.set(operationKey("hubspot", operation), async (context) => {
      const input = objectInput.parse(context.request.input);
      const credential = await revealCredential(context);
      const url = new URL(`https://api.hubapi.com/crm/v3/objects/${objectType}/${encodeURIComponent(input.objectId)}`);
      url.searchParams.set("properties", properties.join(","));
      const response = await fixedFetch(fetcher, url, { headers: bearerHeaders(credential) });
      const body = await providerJson(response);
      return {
        providerObjectRef: `hubspot:${objectType}:${stringField(body, "id") ?? input.objectId}`,
        sourceTimestamp: new Date().toISOString(),
        responseStatusClass: statusClass(response.status),
        properties: selectStringFields(objectField(body, "properties"), properties)
      };
    });
  }
}

function registerGoogleAdsHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("google_ads", "ads.campaign_performance.read"), async (context) => {
    const input = z.object({
      customerId: z.string().regex(/^\d{6,16}$/),
      campaignId: z.string().regex(/^\d{1,24}$/),
      startDate: z.string().date(),
      endDate: z.string().date()
    }).strict().refine((value) => value.startDate <= value.endDate, "startDate must not be after endDate").parse(context.request.input);
    const credential = await revealCredential(context);
    if (!credential.developerToken) throw new ConnectorBrokerError("provider_credential_invalid", "Google Ads developer token is unavailable.", false, true);
    const query = "SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign " +
      `WHERE campaign.id = ${input.campaignId} AND segments.date BETWEEN '${input.startDate}' AND '${input.endDate}'`;
    const response = await fixedFetch(fetcher, `https://googleads.googleapis.com/v25/customers/${input.customerId}/googleAds:searchStream`, {
      method: "POST",
      headers: { ...bearerHeaders(credential), "developer-token": credential.developerToken, "content-type": "application/json" },
      body: JSON.stringify({ query })
    });
    const body = await providerJsonArray(response);
    const rows = body.flatMap((batch) => Array.isArray(batch.results) ? batch.results : []).slice(0, 500);
    return {
      providerObjectRef: `google_ads:customer:${input.customerId}:campaign:${input.campaignId}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      rows: rows.map((row) => selectFields(objectValue(row), ["campaign", "metrics", "segments"]))
    };
  });
  handlers.set(operationKey("google_ads", "ads.budget_change.execute"), async (context) => {
    const input = z.object({
      customerId: z.string().regex(/^\d{6,16}$/),
      campaignBudgetId: z.string().regex(/^\d{1,24}$/),
      amountMicros: z.number().int().min(1_000_000).max(10_000_000_000_000)
    }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    if (!credential.developerToken) throw new ConnectorBrokerError("provider_credential_invalid", "Google Ads developer token is unavailable.", false, true);
    const resourceName = `customers/${input.customerId}/campaignBudgets/${input.campaignBudgetId}`;
    const response = await fixedFetch(fetcher, `https://googleads.googleapis.com/v25/customers/${input.customerId}/campaignBudgets:mutate`, {
      method: "POST",
      headers: { ...bearerHeaders(credential), "developer-token": credential.developerToken, "content-type": "application/json" },
      body: JSON.stringify({ operations: [{ updateMask: "amount_micros", update: { resourceName, amountMicros: String(input.amountMicros) } }] })
    });
    const result = await providerJson(response);
    return {
      providerObjectRef: `google_ads:${resourceName}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      changed: Array.isArray(result.results) && result.results.length === 1
    };
  });
}

function registerSlackHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("slack", "conversations.history.read"), async (context) => {
    const input = z.object({
      channelId: z.string().regex(/^[CG][A-Z0-9]{5,30}$/),
      oldest: z.string().regex(/^\d{1,16}(?:\.\d{1,6})?$/).optional(),
      limit: z.number().int().min(1).max(100).default(50)
    }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const url = new URL("https://slack.com/api/conversations.history");
    url.searchParams.set("channel", input.channelId);
    url.searchParams.set("limit", String(input.limit));
    if (input.oldest) url.searchParams.set("oldest", input.oldest);
    const response = await fixedFetch(fetcher, url, { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    if (body.ok !== true) throw providerRejected("slack_request_rejected", response.status);
    const messages = Array.isArray(body.messages) ? body.messages.slice(0, input.limit).map((message) => {
      const record = objectValue(message);
      return selectStringFields(record, ["ts", "thread_ts", "user", "text"]);
    }) : [];
    return {
      providerObjectRef: `slack:channel:${input.channelId}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      messages,
      hasMore: body.has_more === true
    };
  });
  handlers.set(operationKey("slack", "message.draft.create"), async (context) => {
    const input = slackMessageInput.parse(context.request.input);
    return {
      providerObjectRef: `slack:channel:${input.channelId}:draft`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: "not_sent",
      draft: input
    };
  });
  handlers.set(operationKey("slack", "message.send.execute"), async (context) => {
    const input = slackMessageInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, "https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { ...bearerHeaders(credential), "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: input.channelId, text: input.text, client_msg_id: context.request.idempotencyKey })
    });
    const body = await providerJson(response);
    if (body.ok !== true) throw providerRejected("slack_request_rejected", response.status);
    return {
      providerObjectRef: `slack:channel:${input.channelId}:message:${stringField(body, "ts") ?? "created"}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      delivered: true
    };
  });
}

function registerNotionHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("notion", "page.read"), async (context) => {
    const input = z.object({ pageId: notionId }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, `https://api.notion.com/v1/pages/${encodeURIComponent(input.pageId)}`, {
      headers: { ...bearerHeaders(credential), "notion-version": "2026-03-11" }
    });
    const body = await providerJson(response);
    return {
      providerObjectRef: `notion:page:${input.pageId}`,
      sourceTimestamp: stringField(body, "last_edited_time") ?? new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      page: selectFields(body, ["id", "created_time", "last_edited_time", "archived", "in_trash", "properties", "parent"])
    };
  });
  handlers.set(operationKey("notion", "page.draft.update"), async (context) => {
    const input = z.object({ pageId: notionId, markdown: z.string().trim().min(1).max(100_000) }).strict().parse(context.request.input);
    return {
      providerObjectRef: `notion:page:${input.pageId}:draft`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: "not_sent",
      draft: { pageId: input.pageId, markdown: input.markdown }
    };
  });
}

function registerSalesforceHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  const baseInput = z.object({
    objectType: z.enum(["Account", "Contact", "Opportunity", "Case", "Campaign"]),
    recordId: z.string().regex(/^[A-Za-z0-9]{15,18}$/)
  }).strict();
  handlers.set(operationKey("salesforce", "sobject.read"), async (context) => {
    const input = baseInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const base = trustedInstanceUrl(credential, /(?:^|\.)salesforce\.com$/);
    const response = await fixedFetch(fetcher, new URL(`/services/data/v66.0/sobjects/${input.objectType}/${input.recordId}`, base), {
      headers: bearerHeaders(credential)
    });
    const body = await providerJson(response);
    return {
      providerObjectRef: `salesforce:${input.objectType}:${input.recordId}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      record: selectFields(body, salesforceFields(input.objectType))
    };
  });
  handlers.set(operationKey("salesforce", "sobject.update.execute"), async (context) => {
    const input = baseInput.extend({
      fields: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/), z.union([z.string().max(16_000), z.number(), z.boolean(), z.null()]))
        .refine((fields) => Object.keys(fields).length > 0 && Object.keys(fields).length <= 25)
    }).parse(context.request.input);
    for (const field of Object.keys(input.fields)) {
      if (/^(?:Id|CreatedById|CreatedDate|LastModifiedById|LastModifiedDate|OwnerId|SystemModstamp)$/i.test(field)) {
        throw new ConnectorBrokerError("protected_provider_field", "A protected Salesforce field cannot be changed.", false, true);
      }
    }
    const credential = await revealCredential(context);
    const base = trustedInstanceUrl(credential, /(?:^|\.)salesforce\.com$/);
    const response = await fixedFetch(fetcher, new URL(`/services/data/v66.0/sobjects/${input.objectType}/${input.recordId}`, base), {
      method: "PATCH",
      headers: { ...bearerHeaders(credential), "content-type": "application/json" },
      body: JSON.stringify(input.fields)
    });
    return {
      providerObjectRef: `salesforce:${input.objectType}:${input.recordId}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      updated: true
    };
  });
}

function registerGitHubHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("github", "repository.read"), async (context) => {
    const input = githubRepositoryInput.parse(context.request.input);
    const response = await githubRequest(fetcher, context, `/repos/${input.owner}/${input.repository}`);
    const body = await providerJson(response);
    return {
      providerObjectRef: `github:${input.owner}/${input.repository}`,
      sourceTimestamp: stringField(body, "updated_at") ?? new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      repository: selectFields(body, ["id", "name", "full_name", "private", "archived", "default_branch", "open_issues_count", "updated_at"])
    };
  });
  handlers.set(operationKey("github", "issue.read"), async (context) => {
    const input = githubIssueInput.parse(context.request.input);
    const response = await githubRequest(fetcher, context, `/repos/${input.owner}/${input.repository}/issues/${input.issueNumber}`);
    const body = await providerJson(response);
    return {
      providerObjectRef: `github:${input.owner}/${input.repository}:issue:${input.issueNumber}`,
      sourceTimestamp: stringField(body, "updated_at") ?? new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      issue: selectFields(body, ["id", "number", "title", "state", "body", "labels", "created_at", "updated_at", "closed_at"])
    };
  });
  handlers.set(operationKey("github", "issue.comment.draft"), async (context) => {
    const input = githubIssueInput.extend({ body: z.string().trim().min(1).max(16_000) }).parse(context.request.input);
    return {
      providerObjectRef: `github:${input.owner}/${input.repository}:issue:${input.issueNumber}:comment:draft`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: "not_sent",
      draft: { body: input.body }
    };
  });
  handlers.set(operationKey("github", "pull_request.merge.execute"), async (context) => {
    const input = githubRepositoryInput.extend({
      pullNumber: z.number().int().positive(),
      expectedHeadSha: z.string().regex(/^[a-f0-9]{40}$/),
      commitTitle: z.string().trim().min(1).max(256).optional()
    }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, `https://api.github.com/repos/${input.owner}/${input.repository}/pulls/${input.pullNumber}/merge`, {
      method: "PUT",
      headers: githubHeaders(credential),
      body: JSON.stringify({ sha: input.expectedHeadSha, merge_method: "merge", ...(input.commitTitle ? { commit_title: input.commitTitle } : {}) })
    });
    const body = await providerJson(response);
    return {
      providerObjectRef: `github:${input.owner}/${input.repository}:pull:${input.pullNumber}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      merged: body.merged === true,
      resultingSha: stringField(body, "sha")
    };
  });
}

function registerStripeHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  for (const [operation, resource] of [["customer.read", "customers"], ["subscription.read", "subscriptions"]] as const) {
    handlers.set(operationKey("stripe", operation), async (context) => {
      const input = z.object({ objectId: z.string().regex(/^[A-Za-z0-9_]{5,128}$/) }).strict().parse(context.request.input);
      const credential = await revealCredential(context);
      const response = await fixedFetch(fetcher, `https://api.stripe.com/v1/${resource}/${encodeURIComponent(input.objectId)}`, { headers: bearerHeaders(credential) });
      const body = await providerJson(response);
      return {
        providerObjectRef: `stripe:${resource}:${input.objectId}`,
        sourceTimestamp: new Date().toISOString(),
        responseStatusClass: statusClass(response.status),
        object: selectFields(body, resource === "customers"
          ? ["id", "created", "currency", "delinquent", "email", "name"]
          : ["id", "created", "status", "current_period_end", "cancel_at_period_end", "customer"])
      };
    });
  }
  handlers.set(operationKey("stripe", "refund.execute"), async (context) => {
    const input = z.object({
      chargeId: z.string().regex(/^ch_[A-Za-z0-9]{8,128}$/).optional(),
      paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]{8,128}$/).optional(),
      amount: z.number().int().positive().max(999_999_999).optional(),
      reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional()
    }).strict().refine((value) => Boolean(value.chargeId) !== Boolean(value.paymentIntentId), "Provide exactly one charge or payment intent").parse(context.request.input);
    const credential = await revealCredential(context);
    const body = new URLSearchParams();
    if (input.chargeId) body.set("charge", input.chargeId);
    if (input.paymentIntentId) body.set("payment_intent", input.paymentIntentId);
    if (input.amount) body.set("amount", String(input.amount));
    if (input.reason) body.set("reason", input.reason);
    const response = await fixedFetch(fetcher, "https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { ...bearerHeaders(credential), "content-type": "application/x-www-form-urlencoded", "idempotency-key": context.request.idempotencyKey },
      body
    });
    const result = await providerJson(response);
    return {
      providerObjectRef: `stripe:refund:${stringField(result, "id") ?? "created"}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      refund: selectFields(result, ["id", "amount", "currency", "status", "charge", "payment_intent", "reason"])
    };
  });
}

function registerSupportHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("zendesk", "ticket.read"), async (context) => {
    const input = z.object({ ticketId: z.number().int().positive() }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    if (!credential.subdomain || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(credential.subdomain)) {
      throw new ConnectorBrokerError("provider_credential_invalid", "Zendesk subdomain is unavailable.", false, true);
    }
    const response = await fixedFetch(fetcher, `https://${credential.subdomain}.zendesk.com/api/v2/tickets/${input.ticketId}`, { headers: bearerHeaders(credential) });
    const body = objectField(await providerJson(response), "ticket");
    return {
      providerObjectRef: `zendesk:ticket:${input.ticketId}`,
      sourceTimestamp: stringField(body, "updated_at") ?? new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      ticket: selectFields(body, ["id", "subject", "description", "status", "priority", "type", "tags", "created_at", "updated_at", "organization_id"])
    };
  });
  handlers.set(operationKey("zendesk", "ticket.reply.draft"), async (context) => {
    const input = z.object({ ticketId: z.number().int().positive(), body: z.string().trim().min(1).max(32_000), public: z.boolean().default(false) }).strict().parse(context.request.input);
    return { providerObjectRef: `zendesk:ticket:${input.ticketId}:reply:draft`, sourceTimestamp: new Date().toISOString(), responseStatusClass: "not_sent", draft: input };
  });
  handlers.set(operationKey("intercom", "conversation.read"), async (context) => {
    const input = z.object({ conversationId: safeProviderId }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, `https://api.intercom.io/conversations/${encodeURIComponent(input.conversationId)}?display_as=plaintext`, {
      headers: { ...bearerHeaders(credential), accept: "application/json", "intercom-version": "2.14" }
    });
    const body = await providerJson(response);
    return {
      providerObjectRef: `intercom:conversation:${input.conversationId}`,
      sourceTimestamp: new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      conversation: selectFields(body, ["id", "title", "state", "open", "priority", "created_at", "updated_at", "conversation_message", "conversation_parts", "tags"])
    };
  });
  handlers.set(operationKey("intercom", "conversation.reply.draft"), async (context) => {
    const input = z.object({ conversationId: safeProviderId, body: z.string().trim().min(1).max(32_000) }).strict().parse(context.request.input);
    return { providerObjectRef: `intercom:conversation:${input.conversationId}:reply:draft`, sourceTimestamp: new Date().toISOString(), responseStatusClass: "not_sent", draft: input };
  });
}

function registerHrisHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("greenhouse", "candidate.read"), greenhouseRead("candidates", "candidate", fetcher));
  handlers.set(operationKey("greenhouse", "job.read"), greenhouseRead("jobs", "job", fetcher));
  handlers.set(operationKey("workday", "worker.read"), async (context) => {
    const input = z.object({ workerId: safeProviderId }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const base = trustedInstanceUrl(credential, /(?:^|\.)workday\.com$/);
    const response = await fixedFetch(fetcher, new URL(`/ccx/api/v1/workers/${encodeURIComponent(input.workerId)}`, base), { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    return { providerObjectRef: `workday:worker:${input.workerId}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), worker: selectFields(body, ["id", "descriptor", "businessTitle", "workerType", "location", "organization"])};
  });
}

function registerFinanceHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("quickbooks", "accounting.read"), async (context) => {
    const input = z.object({ entityType: z.enum(["Invoice", "Payment", "Purchase", "Bill", "Account"]), entityId: z.string().regex(/^\d{1,32}$/) }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    if (!credential.realmId || !/^\d{1,32}$/.test(credential.realmId)) throw new ConnectorBrokerError("provider_credential_invalid", "QuickBooks realm ID is unavailable.", false, true);
    const url = new URL(`https://quickbooks.api.intuit.com/v3/company/${credential.realmId}/query`);
    url.searchParams.set("query", `select * from ${input.entityType} where Id = '${input.entityId}'`);
    url.searchParams.set("minorversion", "75");
    const response = await fixedFetch(fetcher, url, { headers: { ...bearerHeaders(credential), accept: "application/json" } });
    const body = await providerJson(response);
    return { providerObjectRef: `quickbooks:${input.entityType}:${input.entityId}`, sourceTimestamp: stringField(body, "time") ?? new Date().toISOString(), responseStatusClass: statusClass(response.status), queryResponse: selectFields(objectField(body, "QueryResponse"), [input.entityType, "startPosition", "maxResults"])};
  });
  handlers.set(operationKey("netsuite", "transaction.read"), async (context) => {
    const input = z.object({ recordType: z.enum(["invoice", "purchaseOrder", "vendorBill", "salesOrder"]), recordId: z.string().regex(/^\d{1,32}$/) }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const base = trustedInstanceUrl(credential, /(?:^|\.)suitetalk\.api\.netsuite\.com$/);
    const response = await fixedFetch(fetcher, new URL(`/services/rest/record/v1/${input.recordType}/${input.recordId}`, base), { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    return { providerObjectRef: `netsuite:${input.recordType}:${input.recordId}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), transaction: selectFields(body, ["id", "tranId", "status", "total", "currency", "entity", "trandate", "dueDate"])};
  });
}

function healthProbe(providerId: ProviderId, credential: StoredCredential): {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
} | undefined {
  const bearer: Record<string, string> = credential.accessToken
    ? { authorization: `Bearer ${credential.accessToken}` }
    : {};
  if (providerId === "github") return { url: "https://api.github.com/user", headers: { ...bearer, accept: "application/vnd.github+json", "user-agent": "loopgraph-connector-broker" } };
  if (providerId === "hubspot") return { url: "https://api.hubapi.com/account-info/v3/details", headers: bearer };
  if (providerId === "slack") return { url: "https://slack.com/api/auth.test", method: "POST", headers: { ...bearer, "content-type": "application/x-www-form-urlencoded" }, body: "" };
  if (providerId === "notion") return { url: "https://api.notion.com/v1/users/me", headers: { ...bearer, "notion-version": "2026-03-11" } };
  if (providerId === "stripe") return { url: "https://api.stripe.com/v1/account", headers: bearer };
  if (providerId === "intercom") return { url: "https://api.intercom.io/me", headers: { ...bearer, accept: "application/json" } };
  if (providerId === "salesforce" && credential.instanceUrl) {
    const url = new URL(credential.instanceUrl);
    if (url.protocol !== "https:" || !/(?:^|\.)salesforce\.com$/.test(url.hostname)) {
      throw new ConnectorBrokerError("provider_instance_untrusted", "Salesforce instance URL is not trusted.", false, true);
    }
    return { url: new URL("/services/data/v61.0/limits", url).toString(), headers: bearer };
  }
  return undefined;
}

type StoredCredential = {
  accessToken?: string;
  instanceUrl?: string;
  developerToken?: string;
  subdomain?: string;
  realmId?: string;
};

function parseCredential(value: string): StoredCredential {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const accessToken = typeof parsed.access_token === "string"
      ? parsed.access_token
      : typeof parsed.token === "string" ? parsed.token : undefined;
    return {
      accessToken,
      instanceUrl: typeof parsed.instance_url === "string" ? parsed.instance_url : undefined,
      developerToken: typeof parsed.developer_token === "string" ? parsed.developer_token : undefined,
      subdomain: typeof parsed.subdomain === "string" ? parsed.subdomain : undefined,
      realmId: typeof parsed.realm_id === "string"
        ? parsed.realm_id
        : typeof parsed.provider_account_id === "string" ? parsed.provider_account_id : undefined
    };
  } catch {
    return { accessToken: value };
  }
}

const safeProviderId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/);
const notionId = z.string().regex(/^[a-fA-F0-9-]{32,36}$/);
const slackMessageInput = z.object({
  channelId: z.string().regex(/^[CGD][A-Z0-9]{5,30}$/),
  text: z.string().trim().min(1).max(16_000)
}).strict();
const githubRepositoryInput = z.object({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)
}).strict();
const githubIssueInput = githubRepositoryInput.extend({ issueNumber: z.number().int().positive() }).strict();

async function revealCredential(context: Parameters<ConnectorOperationHandler>[0]) {
  const lease = await context.getCredential();
  try {
    return parseCredential(lease.reveal());
  } finally {
    lease.dispose();
  }
}

function bearerHeaders(credential: StoredCredential) {
  if (!credential.accessToken) throw new ConnectorBrokerError("provider_credential_invalid", "Provider credential has no usable access token.", false, true);
  return { authorization: `Bearer ${credential.accessToken}` };
}

function githubHeaders(credential: StoredCredential) {
  return {
    ...bearerHeaders(credential),
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "loopgraph-connector-broker",
    "x-github-api-version": "2022-11-28"
  };
}

async function githubRequest(fetcher: typeof fetch, context: Parameters<ConnectorOperationHandler>[0], path: string) {
  const credential = await revealCredential(context);
  return fixedFetch(fetcher, `https://api.github.com${path}`, { headers: githubHeaders(credential) });
}

async function fixedFetch(fetcher: typeof fetch, input: string | URL, init: RequestInit = {}) {
  const response = await fetcher(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 401 || response.status === 403) {
    throw new ConnectorBrokerError("provider_credential_rejected", "Provider rejected the credential or scope.", false, true);
  }
  if (!response.ok) throw providerRejected("provider_request_rejected", response.status);
  return response;
}

function trustedInstanceUrl(credential: StoredCredential, hostname: RegExp) {
  if (!credential.instanceUrl) throw new ConnectorBrokerError("provider_instance_unavailable", "Provider instance URL is unavailable.", false, true);
  const url = new URL(credential.instanceUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !hostname.test(url.hostname)) {
    throw new ConnectorBrokerError("provider_instance_untrusted", "Provider instance URL is not trusted.", false, true);
  }
  return url;
}

function salesforceFields(objectType: "Account" | "Contact" | "Opportunity" | "Case" | "Campaign") {
  return {
    Account: ["Id", "Name", "Type", "Industry", "Website", "AnnualRevenue", "NumberOfEmployees", "LastModifiedDate"],
    Contact: ["Id", "Name", "Title", "Department", "AccountId", "Email", "LastModifiedDate"],
    Opportunity: ["Id", "Name", "AccountId", "StageName", "Amount", "CloseDate", "Probability", "LastModifiedDate"],
    Case: ["Id", "CaseNumber", "AccountId", "ContactId", "Subject", "Status", "Priority", "Type", "LastModifiedDate"],
    Campaign: ["Id", "Name", "Type", "Status", "StartDate", "EndDate", "BudgetedCost", "ActualCost", "LastModifiedDate"]
  }[objectType];
}

function greenhouseRead(resource: "candidates" | "jobs", label: "candidate" | "job", fetcher: typeof fetch): ConnectorOperationHandler {
  return async (context) => {
    const input = z.object({ objectId: z.number().int().positive() }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, `https://harvest.greenhouse.io/v1/${resource}/${input.objectId}`, { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    return {
      providerObjectRef: `greenhouse:${label}:${input.objectId}`,
      sourceTimestamp: stringField(body, "updated_at") ?? new Date().toISOString(),
      responseStatusClass: statusClass(response.status),
      [label]: selectFields(body, label === "candidate"
        ? ["id", "first_name", "last_name", "company", "title", "created_at", "updated_at", "applications", "tags"]
        : ["id", "name", "status", "created_at", "updated_at", "departments", "offices", "openings"])
    };
  };
}

function providerRejected(code: string, status: number) {
  return new ConnectorBrokerError(code, `Provider request was rejected (${statusClass(status)}).`, status === 429 || status >= 500, true);
}

async function providerJson(response: Response) {
  const maximum = 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new ConnectorBrokerError("provider_response_too_large", "Provider response exceeded 1 MiB.", false, true);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximum) throw new ConnectorBrokerError("provider_response_too_large", "Provider response exceeded 1 MiB.", false, true);
  try {
    return objectValue(JSON.parse(text));
  } catch {
    throw new ConnectorBrokerError("provider_response_invalid", "Provider returned an invalid response.", false, true);
  }
}

async function providerJsonArray(response: Response) {
  const maximum = 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new ConnectorBrokerError("provider_response_too_large", "Provider response exceeded 1 MiB.", false, true);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximum) throw new ConnectorBrokerError("provider_response_too_large", "Provider response exceeded 1 MiB.", false, true);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 1_000) throw new Error("invalid array");
    return parsed.map(objectValue);
  } catch {
    throw new ConnectorBrokerError("provider_response_invalid", "Provider returned an invalid response.", false, true);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectField(value: Record<string, unknown>, key: string) {
  return objectValue(value[key]);
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}

function selectStringFields(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.flatMap((key) => typeof value[key] === "string" ? [[key, value[key]]] : []));
}

function selectFields(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.flatMap((key) => isSafeBusinessValue(value[key]) ? [[key, value[key]]] : []));
}

function isSafeBusinessValue(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isSafeBusinessValue(item));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 100 && entries.every(([key, child]) => !/token|secret|authorization|password/i.test(key) && isSafeBusinessValue(child));
  }
  return false;
}

function statusClass(status: number) {
  return `${Math.floor(status / 100)}xx`;
}
