import "server-only";

import type {
  AppEvalRun,
  AppFieldMappingPlan,
  AppInstallPlan,
  AppOnboardingJourney,
  AppInstallationLock,
  AppLifecycleReceipt,
  AppPromotionRecommendation,
  AppReadiness,
  AppUpdatePlan,
  AppSetupDefinition,
  AppSkillDefinition,
  DepartmentPack,
  LoopPackManifest,
  MarketplaceApp,
  MarketplaceAppVersion,
  WorkspaceAppInstallation
} from "loopgraph/core";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
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
  departmentPacks: DepartmentPackSearchEntry[];
  installedCount: number;
};

export type DepartmentPackSearchEntry = {
  pack: DepartmentPack;
  score: number;
  matchedTerms: string[];
};

export type DepartmentPackDetailView = {
  schemaVersion: "loopgraph-department-pack-detail/v1alpha1";
  pack: DepartmentPack;
  applications: Array<{
    definition: DepartmentPack["apps"][number];
    app: MarketplaceApp;
    installation?: WorkspaceAppInstallation;
    readiness?: AppReadiness;
  }>;
  progress: { installed: number; total: number; complete: boolean };
  nextAction: {
    action: "onboard_app" | "operate";
    tool: "loopgraph_app_onboarding_get" | null;
    input: { appId: string; versionRange: string } | null;
    appId?: string;
    reason: string;
  };
};

export type AppGraphPreview = {
  nodes: Array<{
    id: string;
    type: "hermes_brain" | "department" | "app" | "loop" | "company_object";
    label: string;
    parentId?: string;
    installationScoped: boolean;
    shared?: boolean;
    description?: string;
    objectType?: string;
    identityKeys?: string[];
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: "routes" | "owns" | "contains" | "evidence_in" | "supports" | "produces" | "learning_return";
    reason?: string;
    condition?: string;
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
    sourceId: string;
    sourceType: string;
    sourceUri: string;
    sourceRef?: string;
    snapshotDigest: string;
    trustPolicy: "official_only" | "signed" | "explicit_local";
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
  installedLoops: Array<{ installationId: string; loops: Array<{ id: string; name: string; path: string }> }>;
  evaluations: AppEvalRun[];
  lifecycleReceipts: AppLifecycleReceipt[];
  lock?: AppInstallationLock;
};

export type InstalledAppDiff = {
  installationId: string;
  base: { appId: string; version: string; artifactDigest: string };
  derivation?: WorkspaceAppInstallation["derivation"];
  overlay?: WorkspaceAppInstallation["overlay"];
  effectiveConfigurationDigest: string;
  selectedModules: string[];
  history: WorkspaceAppInstallation["history"];
  updateAvailable?: { version: string; artifactDigest: string };
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
  const [search, departmentPacks, installed] = await Promise.all([
    callLoopgraphAppTool("loopgraph_marketplace_search", {
      projectRoot,
      query: input.query,
      department: input.department,
      capability: input.capability,
      limit: 50
    }) as Promise<{ results: Array<Omit<MarketplaceSearchEntry, "installation" | "readiness">> }>,
    callLoopgraphAppTool("loopgraph_department_packs_search", {
      projectRoot,
      query: input.query,
      department: input.department,
      limit: 20
    }) as Promise<{ results: DepartmentPackSearchEntry[] }>,
    getInstalledAppsViewData(projectRoot)
  ]);
  const installationByApp = new Map(installed.installations.map((installation) => [installation.appId, installation]));
  const readinessByInstallation = new Map(installed.readiness.map((readiness) => [readiness.installationId, readiness]));
  return {
    ...input,
    installedCount: installed.installations.length,
    departmentPacks: departmentPacks.results,
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

export async function getDepartmentPackViewData(packId: string): Promise<DepartmentPackDetailView> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  return callLoopgraphAppTool("loopgraph_department_pack_get", {
    projectRoot,
    packId
  }) as Promise<DepartmentPackDetailView>;
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
  mappingPlan: AppFieldMappingPlan;
  journey: AppOnboardingJourney;
}> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const [detail, journey] = await Promise.all([
    callLoopgraphAppTool("loopgraph_app_get", { projectRoot, appId }) as Promise<MarketplaceAppDetail>,
    callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId,
      versionRange: "latest",
      presetId,
      configuration: {},
      actor: "loopgraph-browser"
    }) as Promise<AppOnboardingJourney>
  ]);
  if (!journey.plan || !journey.mappingPlan) throw new Error("App onboarding journey did not return its exact plan and mapping requirements");
  return { detail, plan: journey.plan, mappingPlan: journey.mappingPlan, journey };
}

export async function getInstalledAppViewData(installationId: string): Promise<{
  installation: WorkspaceAppInstallation;
  readiness: AppReadiness;
  evaluations: AppEvalRun[];
  detail: MarketplaceAppDetail;
  promotionRecommendation: AppPromotionRecommendation;
  diff: InstalledAppDiff;
  updatePlan?: AppUpdatePlan;
  lifecycleReceipts: AppLifecycleReceipt[];
  installedLoops: Array<{ id: string; name: string; path: string }>;
  onboardingJourney: AppOnboardingJourney;
}> {
  const projectRoot = getActiveLoopgraphProjectRoot();
  const installed = await callLoopgraphAppTool("loopgraph_app_install_status", {
    projectRoot,
    installationId
  }) as InstalledAppsViewData;
  const installation = installed.installations[0];
  const readiness = installed.readiness[0];
  if (!installation || !readiness) throw new Error(`Installed app not found: ${installationId}`);
  const [detail, promotionRecommendation, diff, onboardingJourney] = await Promise.all([
    callLoopgraphAppTool("loopgraph_app_get", {
      projectRoot,
      appId: installation.appId,
      version: installation.version
    }) as Promise<MarketplaceAppDetail>,
    callLoopgraphAppTool("loopgraph_app_promotion_recommendation", {
      projectRoot,
      installationId
    }) as Promise<AppPromotionRecommendation>,
    callLoopgraphAppTool("loopgraph_app_diff", {
      projectRoot,
      installationId
    }) as Promise<InstalledAppDiff>,
    callLoopgraphAppTool("loopgraph_app_onboarding_get", {
      projectRoot,
      appId: installation.appId,
      installationId
    }) as Promise<AppOnboardingJourney>
  ]);
  const updatePlan = diff.updateAvailable
    ? await callLoopgraphAppTool("loopgraph_app_update_plan", {
        projectRoot,
        installationId,
        versionRange: diff.updateAvailable.version,
        actor: "loopgraph-browser"
      }) as AppUpdatePlan
    : undefined;
  return {
    installation,
    readiness,
    evaluations: installed.evaluations.filter((evaluation) => evaluation.installationId === installationId),
    detail,
    promotionRecommendation,
    diff,
    updatePlan,
    lifecycleReceipts: installed.lifecycleReceipts.filter((receipt) => receipt.installationId === installationId),
    installedLoops: installed.installedLoops.find((entry) => entry.installationId === installationId)?.loops ?? [],
    onboardingJourney
  };
}
