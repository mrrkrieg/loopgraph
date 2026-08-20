import {
  departmentPackCatalogSchema,
  type DepartmentPack
} from "../core";
import { GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG } from "../generated/official-department-pack-catalog";

export const OFFICIAL_DEPARTMENT_PACK_CATALOG = departmentPackCatalogSchema.parse(
  GENERATED_OFFICIAL_DEPARTMENT_PACK_CATALOG
);

export type DepartmentPackSearchInput = {
  query?: string;
  department?: DepartmentPack["department"];
  limit?: number;
};

export type DepartmentPackSearchResult = {
  pack: DepartmentPack;
  score: number;
  matchedTerms: string[];
};

export function getOfficialDepartmentPack(packId: string): DepartmentPack | undefined {
  return OFFICIAL_DEPARTMENT_PACK_CATALOG.packs.find((pack) => pack.id === packId);
}

export function searchOfficialDepartmentPacks(
  input: DepartmentPackSearchInput = {}
): DepartmentPackSearchResult[] {
  const queryTerms = tokenize(input.query);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  return OFFICIAL_DEPARTMENT_PACK_CATALOG.packs
    .filter((pack) => !input.department || pack.department === input.department)
    .map((pack) => scoreDepartmentPack(pack, queryTerms))
    .filter((entry) => queryTerms.length === 0 || entry.matchedTerms.length > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.pack.name.localeCompare(right.pack.name) ||
      left.pack.id.localeCompare(right.pack.id)
    )
    .slice(0, limit);
}

function scoreDepartmentPack(pack: DepartmentPack, queryTerms: string[]): DepartmentPackSearchResult {
  if (queryTerms.length === 0) return { pack, score: 1, matchedTerms: [] };
  const weightedFields = [
    { weight: 10, values: [pack.name, pack.department] },
    { weight: 7, values: [pack.summary, ...pack.businessOutcomes] },
    { weight: 5, values: pack.apps.flatMap((app) => [app.appId, app.reason]) },
    { weight: 3, values: [...pack.sharedContextKeys, ...pack.sharedCapabilities] },
    { weight: 2, values: pack.topology.flatMap((edge) => [edge.type, edge.reason, edge.condition ?? ""]) }
  ];
  const matchedTerms = queryTerms.filter((term) => weightedFields.some((field) =>
    field.values.some((value) => normalize(value).includes(term))
  ));
  const score = weightedFields.reduce((total, field) => total + field.weight * queryTerms.filter((term) =>
    field.values.some((value) => normalize(value).includes(term))
  ).length, 0);
  return { pack, score, matchedTerms };
}

function tokenize(value?: string): string[] {
  return Array.from(new Set(normalize(value ?? "").split(/\s+/).filter((term) => term.length > 1)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_./-]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
