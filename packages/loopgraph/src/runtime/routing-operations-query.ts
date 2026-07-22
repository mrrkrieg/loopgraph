import type { EventRoutingOperationsFilters } from "./event-routing-read-model";

export type RoutingOperationsQuery = EventRoutingOperationsFilters & {
  limit?: number;
};

type SearchParamRecord = Record<string, string | string[] | undefined>;

const receiptStatuses = new Set(["received", "duplicate", "ignored", "replayed", "failed"]);
const actions = new Set(["received", "route", "append_evidence", "ignore", "defer", "request_human", "unhandled"]);
const problemStatuses = new Set([
  "detected",
  "needs_human",
  "routed",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
  "unhandled"
]);

export function routingOperationsQueryFromUrl(url: URL): RoutingOperationsQuery {
  return routingOperationsQueryFromSearchParams(Object.fromEntries(url.searchParams.entries()));
}

export function routingOperationsQueryFromSearchParams(searchParams?: SearchParamRecord | null): RoutingOperationsQuery {
  return {
    ...stringFilter("eventId", searchParams),
    ...stringFilter("source", searchParams),
    ...stringFilter("eventType", searchParams),
    ...enumFilter("receiptStatus", receiptStatuses, searchParams),
    ...enumFilter("action", actions, searchParams),
    ...stringFilter("problemId", searchParams),
    ...enumFilter("problemStatus", problemStatuses, searchParams),
    ...stringFilter("loopId", searchParams),
    ...booleanFilter("needsAttention", searchParams),
    ...booleanFilter("unhandledOnly", searchParams),
    ...limitFilter(searchParams)
  };
}

function stringFilter(key: keyof EventRoutingOperationsFilters, searchParams?: SearchParamRecord | null) {
  const value = firstValue(searchParams?.[key]);
  const cleaned = value?.trim();
  return cleaned ? { [key]: cleaned } : {};
}

function enumFilter(
  key: keyof EventRoutingOperationsFilters,
  allowed: Set<string>,
  searchParams?: SearchParamRecord | null
) {
  const value = firstValue(searchParams?.[key])?.trim();
  return value && allowed.has(value) ? { [key]: value } : {};
}

function booleanFilter(key: "needsAttention" | "unhandledOnly", searchParams?: SearchParamRecord | null) {
  const value = firstValue(searchParams?.[key])?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "on") return { [key]: true };
  if (value === "false" || value === "0" || value === "off") return { [key]: false };
  return {};
}

function limitFilter(searchParams?: SearchParamRecord | null): Pick<RoutingOperationsQuery, "limit"> {
  const value = Number(firstValue(searchParams?.limit));
  if (!Number.isInteger(value)) return {};
  return value >= 1 && value <= 200 ? { limit: value } : {};
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
