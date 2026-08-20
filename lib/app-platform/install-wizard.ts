import type { AppFieldMappingPlan, AppInstallPlan, AppOnboardingJourney, AppSetupDefinition, LoopPackManifest } from "loopgraph/core";

export type InstallWizardQuestion = AppSetupDefinition["questions"][number];

export type InstallWizardState = {
  stage: "configure" | "review";
  plan: AppInstallPlan;
  mappingPlan: AppFieldMappingPlan;
  journey: AppOnboardingProgressView;
  unresolvedQuestionKeys: string[];
  error?: string;
  notice?: string;
};

export type AppOnboardingProgressView = Pick<AppOnboardingJourney, "stage" | "headline" | "progress" | "steps" | "nextAction">;

export function appOnboardingProgressForView(journey: AppOnboardingJourney): AppOnboardingProgressView {
  return {
    stage: journey.stage,
    headline: journey.headline,
    progress: journey.progress,
    steps: journey.steps,
    nextAction: journey.nextAction
  };
}

export type InstallWizardApp = {
  id: string;
  name: string;
  summary: string;
  department: string;
  preset: LoopPackManifest["presets"][number];
  modules: LoopPackManifest["modules"];
  questions: InstallWizardQuestion[];
};

export function configurationFromInstallForm(
  formData: FormData,
  questions: InstallWizardQuestion[]
): Record<string, unknown> {
  return Object.fromEntries(questions.flatMap((question) => {
    const value = formData.get(`config:${question.key}`);
    if (typeof value !== "string" || value.trim() === "") return [];
    return [[question.key, parseQuestionValue(question, value)]];
  }));
}

export function installPlanBlockersForView(plan: AppInstallPlan): string[] {
  return [
    ...plan.missingConfigurationKeys.map((key) => `Resolve ${readableBlocker(key)}.`),
    ...plan.capabilityResolutions
      .filter((resolution) => resolution.required && !["connected", "reusable"].includes(resolution.status))
      .map((resolution) => `Connect ${resolution.capability} (${resolution.status}).`),
    ...plan.permissions
      .filter((permission) => permission.decision === "unresolved")
      .map((permission) => `Review permission ${permission.capability}.`)
  ];
}

export function displayConfigurationValue(value: unknown, valueType: InstallWizardQuestion["valueType"]): string {
  if (value === undefined || value === null) return "";
  if (valueType === "string_list" && Array.isArray(value)) return value.join("\n");
  if (valueType === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseQuestionValue(question: InstallWizardQuestion, value: string): unknown {
  const trimmed = value.trim();
  if (question.valueType === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) throw new Error(`${question.prompt} must be a number`);
    return parsed;
  }
  if (question.valueType === "boolean") {
    if (trimmed !== "true" && trimmed !== "false") throw new Error(`${question.prompt} must be true or false`);
    return trimmed === "true";
  }
  if (question.valueType === "string_list") {
    return trimmed.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  }
  if (question.valueType === "object") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${question.prompt} must be valid JSON`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${question.prompt} must be a JSON object`);
    }
    return parsed;
  }
  return trimmed;
}

function readableBlocker(value: string): string {
  if (value.startsWith("confirmation:")) return `confirmation for ${value.slice("confirmation:".length)}`;
  if (value.startsWith("mapping_confirmation:")) return `field mapping confirmation for ${value.slice("mapping_confirmation:".length).replace(/:/g, " / ")}`;
  if (value.startsWith("mapping:")) return `field mapping for ${value.slice("mapping:".length).replace(/:/g, " / ")}`;
  return value.replace(/_/g, " ");
}
