import {
  buildDemoDiscoverySession,
  generateDemoDailySummary,
  loadDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";
import { getActiveLoopgraphProjectRoot } from "../../lib/loopgraph-runtime/storage-resolver";
import {
  getDiscoverySession as getHermesDiscoverySession,
  listHermesDiscoverySessions
} from "loopgraph/runtime";

export const demoDiscoverySessionId = "acme-saas-discovery";

export type DiscoverySearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function getDiscoverySessionIdFromSearchParams(searchParams?: DiscoverySearchParams) {
  const query = await searchParams;
  const value = query?.sessionId;
  return Array.isArray(value) ? value[0] : value;
}

export async function getDiscoverySessionForView(sessionId?: string) {
  const realSession = sessionId ? await getHermesDiscoverySessionForView(sessionId) : undefined;
  if (realSession) return realSession;
  return (await loadDiscoverySession(demoDiscoverySessionId)) ?? buildDemoDiscoverySession();
}

export async function getHermesDiscoverySessionsForView() {
  return listHermesDiscoverySessions(getActiveLoopgraphProjectRoot());
}

export async function getHermesDiscoverySessionForView(sessionId?: string) {
  if (!sessionId) return undefined;
  return getHermesDiscoverySession(sessionId, getActiveLoopgraphProjectRoot());
}

export async function getDailySummaryForView() {
  return generateDemoDailySummary();
}

export const discoverySteps = [
  { href: "/discovery", label: "Start" },
  { href: "/discovery/company", label: "Project" },
  { href: "/discovery/departments", label: "Departments" },
  { href: "/discovery/questions", label: "Questions" },
  { href: "/discovery/designing", label: "Designing" },
  { href: "/discovery/create-loops", label: "Hermes Loops" }
];
