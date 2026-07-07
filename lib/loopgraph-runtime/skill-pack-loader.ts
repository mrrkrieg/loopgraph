import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  DepartmentSkillPackSchema,
  type DepartmentSkillPack,
  type DepartmentType
} from "../loopgraph-core/department-skills";

export function getDepartmentSkillPackDir(projectRoot = process.cwd()) {
  return path.join(projectRoot, "examples", "department-skills");
}

export async function loadDepartmentSkillPacks(projectRoot = process.cwd()): Promise<DepartmentSkillPack[]> {
  const dir = getDepartmentSkillPackDir(projectRoot);
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort((left, right) => left.localeCompare(right));

  const packs = await Promise.all(files.map(async (file) => loadSkillPackFile(path.join(dir, file))));
  return packs.sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadDepartmentSkillPack(
  idOrDepartmentType: string,
  projectRoot = process.cwd()
): Promise<DepartmentSkillPack | undefined> {
  const packs = await loadDepartmentSkillPacks(projectRoot);
  return packs.find(
    (pack) => pack.id === idOrDepartmentType || pack.departmentType === idOrDepartmentType
  );
}

export async function loadSkillPackFile(filePath: string): Promise<DepartmentSkillPack> {
  const raw = await readFile(filePath, "utf8");
  return DepartmentSkillPackSchema.parse(YAML.parse(raw));
}

export function validateDepartmentSkillPackReferences(pack: DepartmentSkillPack): string[] {
  const errors: string[] = [];
  const blueprintIds = new Set(pack.loopBlueprints.map((blueprint) => blueprint.id));
  const metricKeys = new Set(pack.defaultMetrics.map((metric) => metric.key));

  for (const blueprint of pack.loopBlueprints) {
    for (const metricKey of blueprint.defaultMetrics) {
      if (!metricKeys.has(metricKey)) {
        errors.push(`${pack.id}:${blueprint.id} references unknown metric ${metricKey}`);
      }
    }
  }

  for (const integration of pack.requiredIntegrations) {
    for (const blueprintId of integration.requiredForLoopBlueprints) {
      if (!blueprintIds.has(blueprintId)) {
        errors.push(`${pack.id}:${integration.integrationType} references unknown blueprint ${blueprintId}`);
      }
    }
  }

  return errors;
}

export function findSkillPackByDepartment(
  packs: DepartmentSkillPack[],
  departmentType: DepartmentType
) {
  return packs.find((pack) => pack.departmentType === departmentType) ?? packs.find((pack) => pack.departmentType === "custom");
}

