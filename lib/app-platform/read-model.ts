import "server-only";

import type {
  AppEvalRun,
  AppInstallPlan,
  AppInstallationLock,
  AppReadiness,
  AppSetupDefinition,
  AppSkillDefinition,
  LoopPackManifest,
  MarketplaceApp,
  MarketplaceAppVersion,
  WorkspaceAppInstallation
} from "loopgraph/core";
import { callLoopgraphAppTool } from "@/lib/loopgraph-runtime/app-tools";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";

export type MarketplaceSearchEntry = {
  app: MarketplaceApp;
  score: number;
  matchedTerms: string[];
  installation?: WorkspaceAppInstallation;
  readiness?: AppReadiness;
};

export type MarketplaceViewData = {
  query?: string;
  department?: string;
  capability?: string;
  results: MarketplaceSearchEntry[];
  installedCount: number;
};

export type AppGraphPreview = {
  nodes: Array<{
    id: string;
    type: "hermes_brain" | "department" | "app" | "loop";
    label: string;
    parentId?: string;
    installationScoped: boolean;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: "routes" | "owns" | "contains";
  }>;
};

export type MarketplaceAppDetail = {
  schemaVersion: "loopgraph-app-detail/v1alpha1";
  app: MarketplaceApp;
  selectedVersion: MarketplaceAppVersion;
  manifest: LoopPackManifest;
  provenance: {
    verified: boolean;
    digestMatches: boolean;
    sourceType: string;
    sourceUri: string;
  };
  graphPreview: AppGraphPreview;
  loops: Array<{
    id: string;
    name: string;
    description?: string;
    owner?: string;
    trigger: string;
    outcomes: Array<{ metric?: string; description?: string; direction?: string }>;
  }>;
  skills: AppSkillDefinition[];
  setupQuestions: AppSetupDefinition["questions"];
  evaluationSummary: {
    suites: number;
    scenarios: number;
    scenarioIds: string[];
  };
};

export type InstalledAppsViewData = {
  installations: WorkspaceAppInstallation[];
  applications: Array<{
    installation: WorkspaceAppInstallation;
    app: MarketplaceApp;
  }>;
  readiness: AppReadiness[];
  evaluations: AppEvalRun[];
  lock?: AppInstallationLock;
};

export type MarketplaceAppDetailView = MarketplaceAppDetail & {
  installation?: WorkspaceAppInstallation;
  readiness?: AppReadiness;
};

export async function getMarketplaceViewData(input: {
  query?: string;
  department?: string;
  capability?: string;
} = {}): Promise<MarketplaceViewData> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const [search, installed] = await Promise.all([
    callLoopgraphAppTool("loopgraph_marketplace_search", {
      projectRoot,
      query: input.query,
      department: input.department,
      capability: input.capability,
      limit: 50
    }) as Promise<{ results: Array<Omit<MarketplaceSearchEntry, "installation" | "readiness">> }>,
    getInstalledAppsViewData(projectRoot)
  ]);
  const installationByApp = new Map(installed.installations.map((installation) => [installation.appId, installation]));
  const readinessByInstallation = new Map(installed.readiness.map((readiness) => [readiness.installationId, readiness]));
  return {
    ...input,
    installedCount: installed.installations.length,
    results: search.results.map((result) => {
      const installation = installationByApp.get(result.app.id);
      return {
        ...result,
        installation,
        readiness: installation ? readinessByInstallation.get(installation.id) : undefined
      };
    })
  };
}

export async function getMarketplaceAppDetailView(
  appId: string,
  version?: string
): Promise<MarketplaceAppDetailView> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const [detail, installed] = await Promise.all([
    callLoopgraphAppTool("loopgraph_app_get", { projectRoot, appId, version }) as Promise<MarketplaceAppDetail>,
    getInstalledAppsViewData(projectRoot)
  ]);
  const installation = installed.installations.find((candidate) => candidate.appId === detail.app.id);
  return {
    ...detail,
    installation,
    readiness: installation
      ? installed.readiness.find((candidate) => candidate.installationId === installation.id)
      : undefined
  };
}

export async function getInstalledAppsViewData(
  projectRoot = getActiveLoopgraphProjectRoot()
): Promise<InstalledAppsViewData> {
  return callLoopgraphAppTool("loopgraph_app_install_status", { projectRoot }) as Promise<InstalledAppsViewData>;
}

export async function getAppInstallPlanViewData(appId: string, presetId: string): Promise<{
  detail: MarketplaceAppDetail;
  plan: AppInstallPlan;
}> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const [detail, plan] = await Promise.all([
    callLoopgraphAppTool("loopgraph_app_get", { projectRoot, appId }) as Promise<MarketplaceAppDetail>,
    callLoopgraphAppTool("loopgraph_app_install_plan", {
      projectRoot,
      appId,
      versionRange: "latest",
      presetId,
      configuration: {},
      fieldMappingIds: [],
      actor: "loopgraph-browser"
    }) as Promise<AppInstallPlan>
  ]);
  return { detail, plan };
}

export async function getInstalledAppViewData(installationId: string): Promise<{
  installation: WorkspaceAppInstallation;
  readiness: AppReadiness;
  evaluations: AppEvalRun[];
  detail: MarketplaceAppDetail;
}> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const installed = await callLoopgraphAppTool("loopgraph_app_install_status", {
    projectRoot,
    installationId
  }) as InstalledAppsViewData;
  const installation = installed.installations[0];
  const readiness = installed.readiness[0];
  if (!installation || !readiness) throw new Error(`Installed app not found: ${installationId}`);
  const detail = await callLoopgraphAppTool("loopgraph_app_get", {
    projectRoot,
    appId: installation.appId,
    version: installation.version
  }) as MarketplaceAppDetail;
  return {
    installation,
    readiness,
    evaluations: installed.evaluations.filter((evaluation) => evaluation.installationId === installationId),
    detail
  };
}
