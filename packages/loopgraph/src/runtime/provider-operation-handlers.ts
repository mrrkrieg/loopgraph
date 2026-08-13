import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProviderId } from "../core";
import { ConnectorBrokerError, operationKey, type ConnectorOperationHandler } from "./connector-broker";

export function createProviderOperationHandlers(fetcher: typeof fetch = fetch) {
  const handlers = new Map<string, ConnectorOperationHandler>();
  for (const providerId of [
    "hubspot", "google_ads", "slack", "notion", "salesforce", "stripe", "github",
    "zendesk", "intercom", "workday", "greenhouse", "netsuite", "quickbooks",
    "gmail", "google_calendar", "outlook", "teams", "posthog", "amplitude",
    "linear", "jira", "gitlab", "bigquery", "snowflake"
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
  registerGoogleWorkspaceHandlers(handlers, fetcher);
  registerMicrosoftGraphHandlers(handlers, fetcher);
  registerAnalyticsHandlers(handlers, fetcher);
  registerEngineeringHandlers(handlers, fetcher);
  registerWarehouseHandlers(handlers, fetcher);
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

function registerGoogleWorkspaceHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("gmail", "threads.read"), async (context) => {
    const input = z.object({ threadId: safeProviderId }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.threadId)}`);
    url.searchParams.set("format", "metadata");
    url.searchParams.append("metadataHeaders", "From");
    url.searchParams.append("metadataHeaders", "To");
    url.searchParams.append("metadataHeaders", "Date");
    url.searchParams.append("metadataHeaders", "Subject");
    const response = await fixedFetch(fetcher, url, { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100).map((item) => {
      const message = objectValue(item);
      return selectFields(message, ["id", "threadId", "labelIds", "snippet", "internalDate", "payload"]);
    }) : [];
    return { providerObjectRef: `gmail:thread:${input.threadId}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), messages };
  });
  handlers.set(operationKey("gmail", "drafts.create"), async (context) => {
    const draft = emailMessageInput.parse(context.request.input);
    return { providerObjectRef: "gmail:draft:prepared", sourceTimestamp: new Date().toISOString(), responseStatusClass: "not_sent", draft };
  });
  handlers.set(operationKey("gmail", "messages.send"), async (context) => {
    const input = emailMessageInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const raw = Buffer.from(`To: ${input.to}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.body}`, "utf8").toString("base64url");
    const response = await fixedFetch(fetcher, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { ...bearerHeaders(credential), "content-type": "application/json" },
      body: JSON.stringify({ raw })
    });
    const body = await providerJson(response);
    return { providerObjectRef: `gmail:message:${stringField(body, "id") ?? "sent"}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), delivered: true, threadId: stringField(body, "threadId") };
  });
  handlers.set(operationKey("google_calendar", "events.read"), async (context) => {
    const input = eventWindowInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId ?? "primary")}/events`);
    url.searchParams.set("timeMin", input.startAt);
    url.searchParams.set("timeMax", input.endAt);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", String(input.limit));
    const response = await fixedFetch(fetcher, url, { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    const events = Array.isArray(body.items) ? body.items.slice(0, input.limit).map((item) => selectFields(objectValue(item), ["id", "status", "summary", "start", "end", "attendees", "updated", "organizer"])) : [];
    return { providerObjectRef: `google_calendar:${input.calendarId ?? "primary"}:${input.startAt}:${input.endAt}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), events };
  });
}

function registerMicrosoftGraphHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("outlook", "threads.read"), async (context) => {
    const input = z.object({ conversationId: safeProviderId, limit: z.number().int().min(1).max(100).default(50) }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    url.searchParams.set("$filter", `conversationId eq '${input.conversationId}'`);
    url.searchParams.set("$select", "id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead");
    url.searchParams.set("$top", String(input.limit));
    const response = await fixedFetch(fetcher, url, { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    const messages = Array.isArray(body.value) ? body.value.slice(0, input.limit).map((item) => selectFields(objectValue(item), ["id", "conversationId", "subject", "from", "toRecipients", "receivedDateTime", "sentDateTime", "bodyPreview", "isRead"])) : [];
    return { providerObjectRef: `outlook:conversation:${input.conversationId}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), messages };
  });
  handlers.set(operationKey("outlook", "events.read"), async (context) => {
    const input = eventWindowInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
    url.searchParams.set("startDateTime", input.startAt);
    url.searchParams.set("endDateTime", input.endAt);
    url.searchParams.set("$select", "id,subject,start,end,attendees,organizer,isCancelled,lastModifiedDateTime");
    url.searchParams.set("$top", String(input.limit));
    const response = await fixedFetch(fetcher, url, { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    const events = Array.isArray(body.value) ? body.value.slice(0, input.limit).map((item) => selectFields(objectValue(item), ["id", "subject", "start", "end", "attendees", "organizer", "isCancelled", "lastModifiedDateTime"])) : [];
    return { providerObjectRef: `outlook:calendar:${input.startAt}:${input.endAt}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), events };
  });
  const prepareOutlookDraft: ConnectorOperationHandler = async (context) => {
    const draft = emailMessageInput.parse(context.request.input);
    return { providerObjectRef: "outlook:draft:prepared", sourceTimestamp: new Date().toISOString(), responseStatusClass: "not_sent", draft };
  };
  handlers.set(operationKey("outlook", "drafts.create"), prepareOutlookDraft);
  handlers.set(operationKey("outlook", "message.draft"), prepareOutlookDraft);
  handlers.set(operationKey("outlook", "message.send"), async (context) => {
    const input = emailMessageInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, "https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { ...bearerHeaders(credential), "content-type": "application/json" },
      body: JSON.stringify({ message: { subject: input.subject, body: { contentType: "Text", content: input.body }, toRecipients: [{ emailAddress: { address: input.to } }] }, saveToSentItems: true })
    });
    return { providerObjectRef: `outlook:message:${context.request.idempotencyKey}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), delivered: true };
  });
  handlers.set(operationKey("teams", "messages.draft"), async (context) => {
    const draft = teamsMessageInput.parse(context.request.input);
    return { providerObjectRef: `teams:${draft.teamId}:${draft.channelId}:draft`, sourceTimestamp: new Date().toISOString(), responseStatusClass: "not_sent", draft };
  });
  handlers.set(operationKey("teams", "channel.post"), async (context) => {
    const input = teamsMessageInput.parse(context.request.input);
    const credential = await revealCredential(context);
    const response = await fixedFetch(fetcher, `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(input.teamId)}/channels/${encodeURIComponent(input.channelId)}/messages`, {
      method: "POST",
      headers: { ...bearerHeaders(credential), "content-type": "application/json" },
      body: JSON.stringify({ body: { contentType: "text", content: input.body } })
    });
    const body = await providerJson(response);
    return { providerObjectRef: `teams:${input.teamId}:${input.channelId}:message:${stringField(body, "id") ?? "sent"}`, sourceTimestamp: stringField(body, "createdDateTime") ?? new Date().toISOString(), responseStatusClass: statusClass(response.status), delivered: true };
  });
}

function registerAnalyticsHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  handlers.set(operationKey("posthog", "insights.query"), async (context) => {
    const input = z.object({ insightId: safeProviderId }).strict().parse(context.request.input);
    const credential = await revealCredential(context);
    if (!credential.projectId || !/^\d{1,20}$/.test(credential.projectId)) throw new ConnectorBrokerError("provider_credential_invalid", "PostHog project ID is unavailable.", false, true);
    const base = credential.instanceUrl ? trustedInstanceUrl(credential, /(?:^|\.)posthog\.com$/) : new URL("https://us.posthog.com");
    const response = await fixedFetch(fetcher, new URL(`/api/projects/${credential.projectId}/insights/${encodeURIComponent(input.insightId)}/`, base), { headers: bearerHeaders(credential) });
    const body = await providerJson(response);
    return { providerObjectRef: `posthog:project:${credential.projectId}:insight:${input.insightId}`, sourceTimestamp: stringField(body, "last_modified_at") ?? new Date().toISOString(), responseStatusClass: statusClass(response.status), insight: selectFields(body, ["id", "short_id", "name", "description", "filters", "result", "last_modified_at"]) };
  });
  handlers.set(operationKey("amplitude", "events.query"), async (context) => {
    const input = z.object({ eventType: z.string().trim().min(1).max(200), startDate: z.string().regex(/^\d{8}$/), endDate: z.string().regex(/^\d{8}$/) }).strict().refine((value) => value.startDate <= value.endDate, "startDate must not be after endDate").parse(context.request.input);
    const credential = await revealCredential(context);
    if (!credential.apiKey || !credential.apiSecret) throw new ConnectorBrokerError("provider_credential_invalid", "Amplitude API key and secret are unavailable.", false, true);
    const base = credential.region === "eu" ? "https://analytics.eu.amplitude.com" : "https://amplitude.com";
    const url = new URL("/api/2/events/segmentation", base);
    url.searchParams.set("e", JSON.stringify({ event_type: input.eventType }));
    url.searchParams.set("start", input.startDate);
    url.searchParams.set("end", input.endDate);
    const authorization = Buffer.from(`${credential.apiKey}:${credential.apiSecret}`, "utf8").toString("base64");
    const response = await fixedFetch(fetcher, url, { headers: { authorization: `Basic ${authorization}`, accept: "application/json" } });
    const body = await providerJson(response);
    return { providerObjectRef: `amplitude:event:${createHash("sha256").update(input.eventType).digest("hex").slice(0, 16)}:${input.startDate}:${input.endDate}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), series: selectFields(body, ["data", "timeComputed", "wasCached"]) };
  });
}

function registerEngineeringHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  const linearIssueInput = z.object({ issueId: z.string().trim().min(1).max(255) }).strict();
  const linearIssueQuery = `query LoopgraphIssue($id: String!) { issue(id: $id) { id identifier title description priority createdAt updatedAt canceledAt completedAt url state { id name type } team { id key name } project { id name state } assignee { id name } labels { nodes { id name } } } }`;
  const readLinearIssue = (objectType: "issue" | "incident"): ConnectorOperationHandler => async (context) => {
    const input = linearIssueInput.parse(context.request.input);
    const body = await linearGraphql(fetcher, context, linearIssueQuery, { id: input.issueId });
    const issue = objectField(objectField(body, "data"), "issue");
    return {
      providerObjectRef: `linear:${objectType}:${stringField(issue, "id") ?? input.issueId}`,
      sourceTimestamp: stringField(issue, "updatedAt") ?? new Date().toISOString(),
      responseStatusClass: "success",
      [objectType]: selectFields(issue, ["id", "identifier", "title", "description", "priority", "createdAt", "updatedAt", "canceledAt", "completedAt", "url", "state", "team", "project", "assignee", "labels"])
    };
  };
  handlers.set(operationKey("linear", "issues.read"), readLinearIssue("issue"));
  handlers.set(operationKey("linear", "incidents.read"), readLinearIssue("incident"));
  handlers.set(operationKey("linear", "projects.read"), async (context) => {
    const input = z.object({ projectId: z.string().trim().min(1).max(255) }).strict().parse(context.request.input);
    const body = await linearGraphql(fetcher, context, `query LoopgraphProject($id: String!) { project(id: $id) { id name description state progress startDate targetDate completedAt canceledAt updatedAt teams { nodes { id key name } } } }`, { id: input.projectId });
    const project = objectField(objectField(body, "data"), "project");
    return { providerObjectRef: `linear:project:${stringField(project, "id") ?? input.projectId}`, sourceTimestamp: stringField(project, "updatedAt") ?? new Date().toISOString(), responseStatusClass: "success", project: selectFields(project, ["id", "name", "description", "state", "progress", "startDate", "targetDate", "completedAt", "canceledAt", "updatedAt", "teams"]) };
  });
  handlers.set(operationKey("linear", "issues.create"), async (context) => {
    const input = z.object({ teamId: z.string().trim().min(1).max(255), title: z.string().trim().min(1).max(512), description: z.string().max(100_000).optional(), priority: z.number().int().min(0).max(4).optional(), projectId: z.string().trim().min(1).max(255).optional() }).strict().parse(context.request.input);
    const body = await linearGraphql(fetcher, context, `mutation LoopgraphIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url createdAt updatedAt } } }`, { input });
    const payload = objectField(objectField(body, "data"), "issueCreate");
    if (payload.success !== true) throw new ConnectorBrokerError("provider_request_rejected", "Linear did not create the issue.", false, true);
    const issue = objectField(payload, "issue");
    return { providerObjectRef: `linear:issue:${stringField(issue, "id") ?? "created"}`, sourceTimestamp: stringField(issue, "updatedAt") ?? new Date().toISOString(), responseStatusClass: "success", issue: selectFields(issue, ["id", "identifier", "title", "url", "createdAt", "updatedAt"]) };
  });
  handlers.set(operationKey("linear", "issues.update"), async (context) => {
    const input = z.object({ issueId: z.string().trim().min(1).max(255), title: z.string().trim().min(1).max(512).optional(), description: z.string().max(100_000).nullable().optional(), priority: z.number().int().min(0).max(4).optional(), stateId: z.string().trim().min(1).max(255).optional(), assigneeId: z.string().trim().min(1).max(255).nullable().optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "issueId"), "At least one issue field is required").parse(context.request.input);
    const { issueId, ...fields } = input;
    const body = await linearGraphql(fetcher, context, `mutation LoopgraphIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title url updatedAt } } }`, { id: issueId, input: fields });
    const payload = objectField(objectField(body, "data"), "issueUpdate");
    if (payload.success !== true) throw new ConnectorBrokerError("provider_request_rejected", "Linear did not update the issue.", false, true);
    const issue = objectField(payload, "issue");
    return { providerObjectRef: `linear:issue:${stringField(issue, "id") ?? issueId}`, sourceTimestamp: stringField(issue, "updatedAt") ?? new Date().toISOString(), responseStatusClass: "success", issue: selectFields(issue, ["id", "identifier", "title", "url", "updatedAt"]) };
  });

  const jiraIssueInput = z.object({ issueIdOrKey: z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,19}-[1-9]\d*|\d{1,24})$/) }).strict();
  const readJiraIssue = (objectType: "issue" | "incident"): ConnectorOperationHandler => async (context) => {
    const input = jiraIssueInput.parse(context.request.input);
    const response = await jiraRequest(fetcher, context, `/issue/${encodeURIComponent(input.issueIdOrKey)}?fields=summary,description,status,priority,labels,assignee,reporter,created,updated,resolutiondate,fixVersions,project,issuetype`);
    const body = await providerJson(response);
    return { providerObjectRef: `jira:${objectType}:${stringField(body, "key") ?? input.issueIdOrKey}`, sourceTimestamp: stringField(objectField(body, "fields"), "updated") ?? new Date().toISOString(), responseStatusClass: statusClass(response.status), [objectType]: selectFields(body, ["id", "key", "fields"]) };
  };
  handlers.set(operationKey("jira", "issues.read"), readJiraIssue("issue"));
  handlers.set(operationKey("jira", "incidents.read"), readJiraIssue("incident"));
  handlers.set(operationKey("jira", "versions.read"), async (context) => {
    const input = z.object({ projectIdOrKey: z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,19}|\d{1,24})$/), limit: z.number().int().min(1).max(100).default(50) }).strict().parse(context.request.input);
    const response = await jiraRequest(fetcher, context, `/project/${encodeURIComponent(input.projectIdOrKey)}/version?maxResults=${input.limit}&orderBy=-releaseDate`);
    const body = await providerJson(response);
    const values = Array.isArray(body.values) ? body.values.slice(0, input.limit).map((value) => selectFields(objectValue(value), ["id", "name", "description", "archived", "released", "startDate", "releaseDate", "projectId"])) : [];
    return { providerObjectRef: `jira:project:${input.projectIdOrKey}:versions`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), versions: values };
  });
  handlers.set(operationKey("jira", "issues.create"), async (context) => {
    const input = z.object({ projectIdOrKey: z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,19}|\d{1,24})$/), issueTypeId: z.string().regex(/^\d{1,24}$/), summary: z.string().trim().min(1).max(255), description: z.string().max(100_000).optional(), labels: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,255}$/)).max(20).optional() }).strict().parse(context.request.input);
    const fields = { project: /^\d+$/.test(input.projectIdOrKey) ? { id: input.projectIdOrKey } : { key: input.projectIdOrKey }, issuetype: { id: input.issueTypeId }, summary: input.summary, ...(input.description ? { description: jiraDocument(input.description) } : {}), ...(input.labels ? { labels: input.labels } : {}) };
    const response = await jiraRequest(fetcher, context, "/issue", { method: "POST", body: JSON.stringify({ fields }) });
    const body = await providerJson(response);
    return { providerObjectRef: `jira:issue:${stringField(body, "key") ?? stringField(body, "id") ?? "created"}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), issue: selectFields(body, ["id", "key", "self"]) };
  });
  handlers.set(operationKey("jira", "issues.update"), async (context) => {
    const input = jiraIssueInput.extend({ summary: z.string().trim().min(1).max(255).optional(), description: z.string().max(100_000).nullable().optional(), labels: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,255}$/)).max(20).optional(), priorityId: z.string().regex(/^\d{1,24}$/).optional(), assigneeAccountId: z.string().trim().min(1).max(255).nullable().optional() }).refine((value) => Object.keys(value).some((key) => key !== "issueIdOrKey"), "At least one issue field is required").parse(context.request.input);
    const fields = { ...(input.summary ? { summary: input.summary } : {}), ...(input.description !== undefined ? { description: input.description === null ? null : jiraDocument(input.description) } : {}), ...(input.labels ? { labels: input.labels } : {}), ...(input.priorityId ? { priority: { id: input.priorityId } } : {}), ...(input.assigneeAccountId !== undefined ? { assignee: input.assigneeAccountId === null ? null : { accountId: input.assigneeAccountId } } : {}) };
    const response = await jiraRequest(fetcher, context, `/issue/${encodeURIComponent(input.issueIdOrKey)}`, { method: "PUT", body: JSON.stringify({ fields }) });
    return { providerObjectRef: `jira:issue:${input.issueIdOrKey}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), updated: true };
  });

  handlers.set(operationKey("gitlab", "issues.read"), async (context) => {
    const input = gitlabProjectInput.extend({ issueIid: z.number().int().positive() }).parse(context.request.input);
    const response = await gitlabRequest(fetcher, context, `/projects/${encodeURIComponent(input.projectIdOrPath)}/issues/${input.issueIid}`);
    const body = await providerJson(response);
    return { providerObjectRef: `gitlab:project:${input.projectIdOrPath}:issue:${input.issueIid}`, sourceTimestamp: stringField(body, "updated_at") ?? new Date().toISOString(), responseStatusClass: statusClass(response.status), issue: selectFields(body, ["id", "iid", "project_id", "title", "description", "state", "labels", "milestone", "assignees", "created_at", "updated_at", "closed_at", "web_url"]) };
  });
  handlers.set(operationKey("gitlab", "deployments.read"), async (context) => {
    const input = gitlabProjectInput.extend({ deploymentId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(20) }).parse(context.request.input);
    const path = input.deploymentId ? `/projects/${encodeURIComponent(input.projectIdOrPath)}/deployments/${input.deploymentId}` : `/projects/${encodeURIComponent(input.projectIdOrPath)}/deployments?order_by=updated_at&sort=desc&per_page=${input.limit}`;
    const response = await gitlabRequest(fetcher, context, path);
    const body = await providerJsonValue(response);
    const deployments = Array.isArray(body) ? body.slice(0, input.limit).map((value) => selectGitLabDeployment(objectValue(value))) : [selectGitLabDeployment(objectValue(body))];
    return { providerObjectRef: `gitlab:project:${input.projectIdOrPath}:deployment:${input.deploymentId ?? "latest"}`, sourceTimestamp: new Date().toISOString(), responseStatusClass: statusClass(response.status), deployments };
  });
}

function registerWarehouseHandlers(handlers: Map<string, ConnectorOperationHandler>, fetcher: typeof fetch) {
  const bigQueryOperations = ["company-metrics.query", "finance-forecast.query", "capacity-plan.query"] as const;
  const snowflakeOperations = [
    "company-metrics.query", "finance-forecast.query", "capacity-plan.query",
    "finance_forecast.query", "operating_metrics.query", "capacity_plan.query"
  ] as const;

  for (const operation of bigQueryOperations) {
    handlers.set(operationKey("bigquery", operation), async (context) => {
      const input = warehouseQueryInput.parse(context.request.input);
      const credential = await revealCredential(context);
      const projectId = gcpProjectId.parse(credential.projectId);
      const template = warehouseTemplate(credential, operation, "bigquery");
      const maximumBytesBilled = z.string().regex(/^[1-9]\d{0,18}$/).parse(credential.maximumBytesBilled);
      const response = await fixedFetch(fetcher, `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`, {
        method: "POST",
        headers: { ...bearerHeaders(credential), "content-type": "application/json" },
        body: JSON.stringify({
          query: template.statement,
          useLegacySql: false,
          parameterMode: "NAMED",
          queryParameters: bigQueryBindings(template.statement, input),
          maximumBytesBilled,
          maxResults: input.limit,
          timeoutMs: 10_000
        })
      });
      const body = await providerJson(response);
      if (body.jobComplete === false) {
        throw new ConnectorBrokerError("provider_query_pending", "BigQuery did not complete the bounded query inside the broker window.", true, true);
      }
      return {
        providerObjectRef: `bigquery:project:${projectId}:template:${operation}`,
        sourceTimestamp: new Date().toISOString(),
        responseStatusClass: statusClass(response.status),
        templateId: operation,
        totalRows: stringField(body, "totalRows"),
        totalBytesProcessed: stringField(body, "totalBytesProcessed"),
        schema: selectFields(objectField(body, "schema"), ["fields"]),
        rows: Array.isArray(body.rows) ? body.rows.slice(0, input.limit) : []
      };
    });
  }

  for (const operation of snowflakeOperations) {
    handlers.set(operationKey("snowflake", operation), async (context) => {
      const input = warehouseQueryInput.parse(context.request.input);
      const credential = await revealCredential(context);
      const template = warehouseTemplate(credential, operation, "snowflake");
      const base = trustedInstanceUrl(credential, /(?:^|\.)snowflakecomputing\.com$/);
      const requestId = stableRequestUuid(context.request.idempotencyKey);
      const url = new URL("/api/v2/statements", base);
      url.searchParams.set("requestId", requestId);
      const response = await fixedFetch(fetcher, url, {
        method: "POST",
        headers: {
          ...bearerHeaders(credential),
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "loopgraph-connector-broker/1.0",
          ...(credential.tokenType ? { "x-snowflake-authorization-token-type": credential.tokenType } : {})
        },
        body: JSON.stringify({
          statement: template.statement,
          bindings: snowflakeBindings(template, input),
          timeout: 10,
          database: snowflakeIdentifier.parse(credential.database),
          schema: snowflakeIdentifier.parse(credential.schema),
          warehouse: snowflakeIdentifier.parse(credential.warehouse),
          role: snowflakeIdentifier.parse(credential.role)
        })
      });
      const body = await providerJson(response);
      if (response.status === 202 && !Array.isArray(body.data)) {
        throw new ConnectorBrokerError("provider_query_pending", "Snowflake did not complete the bounded query inside the broker window.", true, true);
      }
      return {
        providerObjectRef: `snowflake:template:${operation}:request:${requestId}`,
        sourceTimestamp: new Date().toISOString(),
        responseStatusClass: statusClass(response.status),
        templateId: operation,
        statementHandle: stringField(body, "statementHandle"),
        resultSetMetaData: selectFields(objectField(body, "resultSetMetaData"), ["numRows", "format", "rowType"]),
        rows: Array.isArray(body.data) ? body.data.slice(0, input.limit) : []
      };
    });
  }
}

async function linearGraphql(fetcher: typeof fetch, context: Parameters<ConnectorOperationHandler>[0], query: string, variables: Record<string, unknown>) {
  const credential = await revealCredential(context);
  const response = await fixedFetch(fetcher, "https://api.linear.app/graphql", { method: "POST", headers: { ...bearerHeaders(credential), "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const body = await providerJson(response);
  if (Array.isArray(body.errors) && body.errors.length > 0) throw new ConnectorBrokerError("provider_request_rejected", "Linear rejected the fixed GraphQL operation.", false, true);
  return body;
}

async function jiraRequest(fetcher: typeof fetch, context: Parameters<ConnectorOperationHandler>[0], path: string, init: RequestInit = {}) {
  const credential = await revealCredential(context);
  if (!credential.cloudId || !/^[A-Za-z0-9-]{8,128}$/.test(credential.cloudId)) throw new ConnectorBrokerError("provider_credential_invalid", "Jira Cloud ID is unavailable.", false, true);
  return fixedFetch(fetcher, `https://api.atlassian.com/ex/jira/${encodeURIComponent(credential.cloudId)}/rest/api/3${path}`, { ...init, headers: { ...bearerHeaders(credential), accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
}

async function gitlabRequest(fetcher: typeof fetch, context: Parameters<ConnectorOperationHandler>[0], path: string) {
  const credential = await revealCredential(context);
  return fixedFetch(fetcher, `https://gitlab.com/api/v4${path}`, { headers: bearerHeaders(credential) });
}

function jiraDocument(text: string) {
  return { type: "doc", version: 1, content: text.split(/\n{2,}/).slice(0, 200).map((paragraph) => ({ type: "paragraph", content: [{ type: "text", text: paragraph.slice(0, 10_000) }] })) };
}

function selectGitLabDeployment(value: Record<string, unknown>) {
  return selectFields(value, ["id", "iid", "status", "created_at", "updated_at", "finished_at", "ref", "sha", "tag", "environment", "deployable", "user"]);
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
  if (providerId === "gmail") return { url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", headers: bearer };
  if (providerId === "google_calendar") return { url: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", headers: bearer };
  if (providerId === "outlook" || providerId === "teams") return { url: "https://graph.microsoft.com/v1.0/me?$select=id", headers: bearer };
  if (providerId === "posthog") {
    const base = credential.instanceUrl ? trustedInstanceUrl(credential, /(?:^|\.)posthog\.com$/) : new URL("https://us.posthog.com");
    return { url: new URL("/api/users/@me/", base).toString(), headers: bearer };
  }
  if (providerId === "amplitude" && credential.apiKey && credential.apiSecret) {
    const base = credential.region === "eu" ? "https://analytics.eu.amplitude.com" : "https://amplitude.com";
    return { url: `${base}/api/2/events/list`, headers: { authorization: `Basic ${Buffer.from(`${credential.apiKey}:${credential.apiSecret}`, "utf8").toString("base64")}` } };
  }
  if (providerId === "linear") return { url: "https://api.linear.app/graphql", method: "POST", headers: { ...bearer, "content-type": "application/json" }, body: JSON.stringify({ query: "query LoopgraphHealth { viewer { id } }" }) };
  if (providerId === "jira" && credential.cloudId && /^[A-Za-z0-9-]{8,128}$/.test(credential.cloudId)) return { url: `https://api.atlassian.com/ex/jira/${encodeURIComponent(credential.cloudId)}/rest/api/3/myself`, headers: bearer };
  if (providerId === "gitlab") return { url: "https://gitlab.com/api/v4/user", headers: bearer };
  if (providerId === "bigquery" && credential.projectId && gcpProjectId.safeParse(credential.projectId).success) {
    return {
      url: `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(credential.projectId)}/queries`,
      method: "POST",
      headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ query: "SELECT 1 AS loopgraph_health", useLegacySql: false, maximumBytesBilled: "0", maxResults: 1, timeoutMs: 5_000 })
    };
  }
  if (providerId === "snowflake" && credential.accessToken && credential.database && credential.schema && credential.warehouse && credential.role) {
    const base = trustedInstanceUrl(credential, /(?:^|\.)snowflakecomputing\.com$/);
    return {
      url: new URL("/api/v2/statements", base).toString(),
      method: "POST",
      headers: {
        ...bearer,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "loopgraph-connector-broker/1.0",
        ...(credential.tokenType ? { "x-snowflake-authorization-token-type": credential.tokenType } : {})
      },
      body: JSON.stringify({ statement: "SELECT CURRENT_ACCOUNT() AS LOOPGRAPH_HEALTH", timeout: 5, database: snowflakeIdentifier.parse(credential.database), schema: snowflakeIdentifier.parse(credential.schema), warehouse: snowflakeIdentifier.parse(credential.warehouse), role: snowflakeIdentifier.parse(credential.role) })
    };
  }
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
  projectId?: string;
  apiKey?: string;
  apiSecret?: string;
  region?: "us" | "eu";
  cloudId?: string;
  maximumBytesBilled?: string;
  database?: string;
  schema?: string;
  warehouse?: string;
  role?: string;
  tokenType?: "OAUTH" | "KEYPAIR_JWT" | "PROGRAMMATIC_ACCESS_TOKEN";
  queryTemplates?: Record<string, WarehouseQueryTemplate>;
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
        : typeof parsed.provider_account_id === "string" ? parsed.provider_account_id : undefined,
      projectId: typeof parsed.project_id === "string" || typeof parsed.project_id === "number" ? String(parsed.project_id) : undefined,
      apiKey: typeof parsed.api_key === "string" ? parsed.api_key : undefined,
      apiSecret: typeof parsed.api_secret === "string" ? parsed.api_secret : undefined,
      region: parsed.region === "eu" ? "eu" : parsed.region === "us" ? "us" : undefined,
      cloudId: typeof parsed.cloud_id === "string"
        ? parsed.cloud_id
        : typeof parsed.provider_account_id === "string" ? parsed.provider_account_id : undefined,
      maximumBytesBilled: typeof parsed.maximum_bytes_billed === "string" || typeof parsed.maximum_bytes_billed === "number"
        ? String(parsed.maximum_bytes_billed)
        : undefined,
      database: typeof parsed.database === "string" ? parsed.database : undefined,
      schema: typeof parsed.schema === "string" ? parsed.schema : undefined,
      warehouse: typeof parsed.warehouse === "string" ? parsed.warehouse : undefined,
      role: typeof parsed.role === "string" ? parsed.role : undefined,
      tokenType: parsed.token_type === "OAUTH" || parsed.token_type === "KEYPAIR_JWT" || parsed.token_type === "PROGRAMMATIC_ACCESS_TOKEN"
        ? parsed.token_type
        : undefined,
      queryTemplates: parseWarehouseQueryTemplates(parsed.query_templates)
    };
  } catch {
    return { accessToken: value };
  }
}

function parseWarehouseQueryTemplates(value: unknown): Record<string, WarehouseQueryTemplate> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, WarehouseQueryTemplate> = {};
  for (const [operation, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate === "string") {
      result[operation] = { statement: candidate };
      continue;
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.statement !== "string") continue;
    const rawOrder = record.binding_order ?? record.bindingOrder;
    const bindingOrder = Array.isArray(rawOrder)
      ? rawOrder.filter((item): item is WarehouseBindingName => ["windowStart", "windowEnd", "subjectId", "limit"].includes(String(item)))
      : undefined;
    result[operation] = { statement: record.statement, ...(bindingOrder ? { bindingOrder } : {}) };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const safeProviderId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/);
const notionId = z.string().regex(/^[a-fA-F0-9-]{32,36}$/);
const emailMessageInput = z.object({
  to: z.string().email().max(320),
  subject: z.string().trim().min(1).max(998).refine((value) => !/[\r\n]/.test(value), "subject cannot contain line breaks"),
  body: z.string().min(1).max(100_000)
}).strict();
const eventWindowInput = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  calendarId: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(100).default(50)
}).strict().refine((value) => value.startAt <= value.endAt, "startAt must not be after endAt");
const teamsMessageInput = z.object({
  teamId: safeProviderId,
  channelId: safeProviderId,
  body: z.string().trim().min(1).max(16_000)
}).strict();
const slackMessageInput = z.object({
  channelId: z.string().regex(/^[CGD][A-Z0-9]{5,30}$/),
  text: z.string().trim().min(1).max(16_000)
}).strict();
const githubRepositoryInput = z.object({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)
}).strict();
const githubIssueInput = githubRepositoryInput.extend({ issueNumber: z.number().int().positive() }).strict();
const gitlabProjectInput = z.object({
  projectIdOrPath: z.string().trim().min(1).max(512).regex(/^(?:\d{1,24}|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){1,20})$/)
}).strict();
const warehouseQueryInput = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  subjectId: safeProviderId.optional(),
  limit: z.number().int().min(1).max(500).default(100)
}).strict().superRefine((value, context) => {
  const start = Date.parse(value.windowStart);
  const end = Date.parse(value.windowEnd);
  if (start >= end) context.addIssue({ code: z.ZodIssueCode.custom, path: ["windowEnd"], message: "windowEnd must be after windowStart" });
  if (end - start > 366 * 24 * 60 * 60 * 1_000) context.addIssue({ code: z.ZodIssueCode.custom, path: ["windowEnd"], message: "warehouse query windows cannot exceed 366 days" });
});
const gcpProjectId = z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/);
const snowflakeIdentifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_$]{0,254}$/);

type WarehouseQueryInput = z.infer<typeof warehouseQueryInput>;
type WarehouseBindingName = "windowStart" | "windowEnd" | "subjectId" | "limit";
type WarehouseQueryTemplate = { statement: string; bindingOrder?: WarehouseBindingName[] };

function warehouseTemplate(credential: StoredCredential, operation: string, providerId: "bigquery" | "snowflake") {
  const candidate = credential.queryTemplates?.[operation];
  if (!candidate) throw new ConnectorBrokerError("provider_query_template_missing", `No approved ${providerId} query template is configured for ${operation}.`, false, true);
  const statement = approvedReadStatement(candidate.statement);
  if (providerId === "bigquery") {
    const placeholders = [...statement.matchAll(/@([a-z_][a-z0-9_]*)/gi)].map((match) => match[1]!.toLowerCase());
    const allowed = new Set(["window_start", "window_end", "subject_id", "limit"]);
    if (!placeholders.includes("window_start") || !placeholders.includes("window_end") || placeholders.some((name) => !allowed.has(name))) {
      throw new ConnectorBrokerError("provider_query_template_invalid", "BigQuery templates must use bounded @window_start and @window_end parameters and only approved parameter names.", false, true);
    }
  } else {
    const order = candidate.bindingOrder ?? [];
    const placeholderCount = [...statement].filter((character) => character === "?").length;
    if (placeholderCount === 0 || placeholderCount !== order.length || order.length > 16 || !order.includes("windowStart") || !order.includes("windowEnd")) {
      throw new ConnectorBrokerError("provider_query_template_invalid", "Snowflake templates must bind every placeholder and include windowStart and windowEnd.", false, true);
    }
  }
  return { statement, bindingOrder: candidate.bindingOrder };
}

function approvedReadStatement(value: string) {
  const statement = z.string().trim().min(1).max(100_000).parse(value);
  if (!/^(?:select|with)\b/i.test(statement) || /;|--|\/\*/.test(statement)) {
    throw new ConnectorBrokerError("provider_query_template_invalid", "Warehouse query templates must contain one comment-free SELECT statement.", false, true);
  }
  if (/\b(?:insert|update|delete|merge|create|alter|drop|truncate|call|execute|grant|revoke|copy|put|get|remove|export)\b/i.test(statement)) {
    throw new ConnectorBrokerError("provider_query_template_invalid", "Warehouse query templates cannot contain mutation, administration, transfer, or export operations.", false, true);
  }
  return statement;
}

function bigQueryBindings(statement: string, input: WarehouseQueryInput) {
  const names = [...new Set([...statement.matchAll(/@([a-z_][a-z0-9_]*)/gi)].map((match) => match[1]!.toLowerCase()))];
  if (names.includes("subject_id") && !input.subjectId) {
    throw new ConnectorBrokerError("provider_query_input_missing", "The approved query template requires subjectId.", false, true);
  }
  const values = {
    window_start: { type: "TIMESTAMP", value: input.windowStart },
    window_end: { type: "TIMESTAMP", value: input.windowEnd },
    subject_id: { type: "STRING", value: input.subjectId ?? "" },
    limit: { type: "INT64", value: String(input.limit) }
  } as const;
  return names.map((name) => ({
    name,
    parameterType: { type: values[name as keyof typeof values].type },
    parameterValue: { value: values[name as keyof typeof values].value }
  }));
}

function snowflakeBindings(template: WarehouseQueryTemplate, input: WarehouseQueryInput) {
  const order = template.bindingOrder ?? [];
  if (order.includes("subjectId") && !input.subjectId) {
    throw new ConnectorBrokerError("provider_query_input_missing", "The approved query template requires subjectId.", false, true);
  }
  return Object.fromEntries(order.map((name, index) => [String(index + 1), {
    type: name === "limit" ? "FIXED" : "TEXT",
    value: String(input[name] ?? "")
  }]));
}

function stableRequestUuid(value: string) {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = ["8", "9", "a", "b"][parseInt(digest[16]!, 16) % 4]!;
  const text = digest.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

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

async function providerJsonValue(response: Response): Promise<unknown> {
  const maximum = 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) throw new ConnectorBrokerError("provider_response_too_large", "Provider response exceeded 1 MiB.", false, true);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximum) throw new ConnectorBrokerError("provider_response_too_large", "Provider response exceeded 1 MiB.", false, true);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid JSON value");
    return parsed;
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
