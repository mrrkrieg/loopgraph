import type {
  BusinessDiscoverySession,
  CompanyDiscoveryProfile,
  DepartmentGoal,
  DepartmentProfile,
  ProcessGoalMapping
} from "loopgraph/core";
import type { DepartmentSkillPack, DepartmentType } from "loopgraph/core";
import type { ProcessInventoryItem, ProcessPainPoint } from "loopgraph/core";

const defaultDepartments: DepartmentType[] = [
  "management",
  "marketing",
  "sales",
  "product",
  "customer_success"
];

const departmentToolHints: Record<DepartmentType, string[]> = {
  management: ["okr", "dashboard", "board", "slack", "spreadsheet"],
  marketing: ["ads", "analytics", "website_cms", "seo"],
  sales: ["crm", "email", "calendar"],
  product: ["support", "ticketing", "linear", "github", "analytics"],
  customer_success: ["support", "usage", "crm", "calendar"],
  engineering: ["github", "linear", "ticketing", "incident"],
  ops_finance: ["finance", "spreadsheet", "database"],
  hr_talent: ["ats", "hris", "calendar"],
  legal_compliance: ["contract", "security", "compliance"],
  custom: []
};

export function inferDepartments(
  session: BusinessDiscoverySession,
  skillPacks: DepartmentSkillPack[] = []
): DepartmentProfile[] {
  if (session.departmentProfiles.length > 0) {
    return session.departmentProfiles;
  }

  const company = session.companyProfile;
  const fromCompany = company?.departments.length ? company.departments : inferDepartmentTypes(company);
  const departments = fromCompany.length > 0 ? fromCompany : defaultDepartments;

  return departments.map((departmentType) => {
    const pack = skillPacks.find((item) => item.departmentType === departmentType);
    return {
      id: `${session.companyId}:${departmentType}`,
      companyId: session.companyId,
      departmentType,
      name: pack?.name ?? formatDepartmentType(departmentType),
      ownerRole: departmentType === "management" ? "Leadership" : `${formatDepartmentType(departmentType)} owner`,
      goal: pickDepartmentGoal(company, departmentType, pack),
      tools: toolsForDepartment(company, departmentType),
      painPoints: painForDepartment(company, departmentType),
      riskTolerance: company?.riskTolerance ?? "medium",
      answers: {}
    };
  });
}

export function buildProcessInventory(session: BusinessDiscoverySession): ProcessInventoryItem[] {
  if (session.processInventory.length > 0) {
    return session.processInventory;
  }

  const departments = session.departmentProfiles.length > 0
    ? session.departmentProfiles
    : inferDepartments(session);

  return departments.flatMap((department) => {
    const work = session.companyProfile?.recurringWork.filter((item) =>
      item.toLowerCase().includes(department.departmentType.split("_")[0])
    ) ?? [];
    const seed = work.length > 0 ? work : [`${department.name} weekly operating review`];
    return seed.map((item, index) => processFromText(session.companyId, department, item, index));
  });
}

export function inferGoals(session: BusinessDiscoverySession): DepartmentGoal[] {
  const departments = session.departmentProfiles.length > 0
    ? session.departmentProfiles
    : inferDepartments(session);

  return departments.map((department) => ({
    id: `${department.id}:goal`,
    companyId: session.companyId,
    departmentId: department.id,
    label: department.goal ?? session.companyProfile?.primaryGoal ?? "Improve operating leverage with safe loops",
    metricKeys: []
  }));
}

export function inferProcessGoalMappings(
  session: BusinessDiscoverySession,
  goals = inferGoals(session)
): ProcessGoalMapping[] {
  const processes = session.processInventory.length > 0
    ? session.processInventory
    : buildProcessInventory(session);

  return processes.flatMap((process) => {
    const goal = goals.find((item) => item.departmentId === process.departmentId);
    return goal ? [{
      id: `${process.id}:${goal.id}`,
      processId: process.id,
      goalId: goal.id,
      confidence: 0.82
    }] : [];
  });
}

function inferDepartmentTypes(company?: CompanyDiscoveryProfile): DepartmentType[] {
  if (!company) return defaultDepartments;
  const haystack = [
    company.description,
    company.primaryGoal,
    ...company.tools,
    ...company.bottlenecks,
    ...company.recurringWork
  ].filter(Boolean).join(" ").toLowerCase();
  const found = Object.entries(departmentToolHints)
    .filter(([department]) => department !== "custom")
    .filter(([, hints]) => hints.some((hint) => haystack.includes(hint)))
    .map(([department]) => department as DepartmentType);
  return Array.from(new Set(["management" as DepartmentType, ...found]));
}

function toolsForDepartment(company: CompanyDiscoveryProfile | undefined, departmentType: DepartmentType) {
  const tools = company?.tools ?? [];
  const hints = departmentToolHints[departmentType];
  return tools.filter((tool) => hints.some((hint) => tool.toLowerCase().includes(hint)));
}

function painForDepartment(company: CompanyDiscoveryProfile | undefined, departmentType: DepartmentType) {
  const label = departmentType.split("_")[0];
  return company?.bottlenecks.filter((item) => item.toLowerCase().includes(label)) ?? [];
}

function pickDepartmentGoal(
  company: CompanyDiscoveryProfile | undefined,
  departmentType: DepartmentType,
  pack?: DepartmentSkillPack
) {
  if (departmentType === "management") return company?.primaryGoal ?? pack?.commonGoals[0]?.label;
  return pack?.commonGoals[0]?.label ?? company?.primaryGoal;
}

function processFromText(
  companyId: string,
  department: DepartmentProfile,
  text: string,
  index: number
): ProcessInventoryItem {
  const lower = text.toLowerCase();
  const painPoints: ProcessPainPoint[] = [];
  if (lower.includes("manual") || lower.includes("prep")) painPoints.push("manual_context_gathering");
  if (lower.includes("follow")) painPoints.push("missed_follow_up");
  if (lower.includes("approval")) painPoints.push("approval_bottleneck");
  if (lower.includes("metric") || lower.includes("measure")) painPoints.push("missing_measurement");

  return {
    id: `${department.id}:process:${index + 1}`,
    companyId,
    departmentId: department.id,
    name: text,
    description: text,
    recurrence: lower.includes("daily") ? "daily" : "weekly",
    currentInputs: department.tools,
    currentOutputs: ["review packet", "recommendation"],
    systemsTouched: department.tools,
    currentOwner: department.ownerRole,
    painPoints,
    riskLevel: department.riskTolerance === "high" ? "high" : "medium",
    customerFacing: lower.includes("customer"),
    requiresHumanJudgment: true,
    candidateAutomationMode: "recommend_with_review"
  };
}

function formatDepartmentType(departmentType: DepartmentType) {
  return departmentType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

