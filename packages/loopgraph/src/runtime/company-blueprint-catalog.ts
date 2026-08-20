import {
  companyBlueprintCatalogSchema,
  type CompanyBlueprint
} from "../core";
import { GENERATED_OFFICIAL_COMPANY_BLUEPRINT_CATALOG } from "../generated/official-company-blueprint-catalog";

export const OFFICIAL_COMPANY_BLUEPRINT_CATALOG = companyBlueprintCatalogSchema.parse(
  GENERATED_OFFICIAL_COMPANY_BLUEPRINT_CATALOG
);

export type CompanyBlueprintSearchResult = {
  blueprint: CompanyBlueprint;
  score: number;
  matchedTerms: string[];
};

export function getOfficialCompanyBlueprint(blueprintId: string): CompanyBlueprint | undefined {
  return OFFICIAL_COMPANY_BLUEPRINT_CATALOG.blueprints.find((blueprint) => blueprint.id === blueprintId);
}

export function searchOfficialCompanyBlueprints(input: { query?: string; limit?: number } = {}): CompanyBlueprintSearchResult[] {
  const terms = tokenize(input.query);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 20));
  return OFFICIAL_COMPANY_BLUEPRINT_CATALOG.blueprints
    .map((blueprint) => scoreBlueprint(blueprint, terms))
    .filter((entry) => terms.length === 0 || entry.matchedTerms.length > 0)
    .sort((left, right) => right.score - left.score || left.blueprint.name.localeCompare(right.blueprint.name))
    .slice(0, limit);
}

function scoreBlueprint(blueprint: CompanyBlueprint, terms: string[]): CompanyBlueprintSearchResult {
  if (terms.length === 0) return { blueprint, score: 1, matchedTerms: [] };
  const weightedFields = [
    { weight: 10, values: [blueprint.name, blueprint.companyProfile] },
    { weight: 7, values: [blueprint.summary, ...blueprint.businessOutcomes] },
    { weight: 4, values: blueprint.objectContracts.flatMap((contract) => [contract.objectType, contract.description]) },
    { weight: 3, values: blueprint.topology.flatMap((edge) => [edge.type, edge.objectType, edge.reason]) },
    { weight: 2, values: blueprint.packs.flatMap((pack) => [pack.packId, pack.reason]) }
  ];
  const matchedTerms = terms.filter((term) => weightedFields.some((field) => field.values.some((value) => normalize(value).includes(term))));
  const score = weightedFields.reduce((total, field) => total + field.weight * terms.filter((term) => field.values.some((value) => normalize(value).includes(term))).length, 0);
  return { blueprint, score, matchedTerms };
}

function tokenize(value?: string): string[] {
  return Array.from(new Set(normalize(value ?? "").split(/\s+/).filter((term) => term.length > 1)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_./-]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
