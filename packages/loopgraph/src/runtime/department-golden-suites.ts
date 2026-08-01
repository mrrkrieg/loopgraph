import { PREBUILT_COMPANY_LOOPS, type DepartmentType } from "../core";

export type DepartmentGoldenEventSuite = {
  schemaVersion: "department-golden-suite/v1alpha1";
  department: DepartmentType;
  loopTemplateId: string;
  positive: Array<{ eventType: string; subjectType: string; normalizedPayload: Record<string, unknown>; evidenceRefs: string[] }>;
  excluded: Array<{ eventType: string; reason: string }>;
  missingContext: Array<{ eventType: string; omittedField: string; expectedAction: "request_human" }>;
};

export function buildDepartmentGoldenEventSuites(): DepartmentGoldenEventSuite[] {
  return PREBUILT_COMPANY_LOOPS.map((loop) => ({
    schemaVersion: "department-golden-suite/v1alpha1",
    department: loop.departmentType,
    loopTemplateId: loop.templateId,
    positive: loop.eventTypes.map((eventType, index) => ({
      eventType,
      subjectType: loop.subjectTypes[index % loop.subjectTypes.length]!,
      normalizedPayload: payloadForRequiredContext(loop.requiredContext),
      evidenceRefs: ["evidence:golden-fixture"]
    })),
    excluded: loop.exclusionRules.map((rule) => ({ eventType: rule.eventTypePattern, reason: rule.reason })),
    missingContext: loop.requiredContext.slice(0, 1).map((omittedField) => ({ eventType: loop.eventTypes[0]!, omittedField, expectedAction: "request_human" as const }))
  }));
}

function payloadForRequiredContext(fields: string[]) {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.startsWith("normalizedPayload.")) continue;
    const path = field.slice("normalizedPayload.".length).split(".");
    let target = payload;
    path.forEach((part, index) => {
      if (index === path.length - 1) target[part] = `fixture_${part}`;
      else {
        const existing = target[part];
        const next = existing && typeof existing === "object" && !Array.isArray(existing)
          ? existing as Record<string, unknown>
          : {};
        target[part] = next;
        target = next;
      }
    });
  }
  return payload;
}
