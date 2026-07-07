import {
  buildDemoDiscoverySession,
  generateDemoDailySummary,
  loadDiscoverySession
} from "@/lib/loopgraph-runtime/discovery-engine";

export const demoDiscoverySessionId = "acme-saas-discovery";

export async function getDiscoverySessionForView() {
  return (await loadDiscoverySession(demoDiscoverySessionId)) ?? buildDemoDiscoverySession();
}

export async function getDailySummaryForView() {
  return generateDemoDailySummary();
}

export const discoverySteps = [
  { href: "/discovery/company", label: "Company" },
  { href: "/discovery/departments", label: "Departments" },
  { href: "/discovery/processes", label: "Processes" },
  { href: "/discovery/goals", label: "Goals" },
  { href: "/discovery/access", label: "Access" },
  { href: "/discovery/recommendations", label: "Recommendations" },
  { href: "/discovery/human-requirements", label: "Human Input" },
  { href: "/discovery/metrics", label: "Metrics" },
  { href: "/discovery/create-loops", label: "Create Loops" }
];

