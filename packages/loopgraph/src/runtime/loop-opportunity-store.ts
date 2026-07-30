import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  graphChangeSetSchema,
  loopOpportunitySchema,
  type DepartmentType,
  type GraphChangeSet,
  type LoopOpportunity
} from "../core";

export type LoopOpportunityFilters = {
  status?: LoopOpportunity["status"];
  department?: DepartmentType;
  minimumScore?: number;
};

export interface LoopOpportunityStore {
  readonly persistence: "file" | "distributed";
  saveOpportunity(opportunity: LoopOpportunity): Promise<void>;
  getOpportunity(opportunityId: string): Promise<LoopOpportunity | undefined>;
  listOpportunities(filters?: LoopOpportunityFilters): Promise<LoopOpportunity[]>;
  saveGraphChangeSet(changeSet: GraphChangeSet): Promise<void>;
  getGraphChangeSet(changeSetId: string): Promise<GraphChangeSet | undefined>;
  listGraphChangeSets(opportunityId?: string): Promise<GraphChangeSet[]>;
}

export class FileLoopOpportunityStore implements LoopOpportunityStore {
  readonly persistence = "file" as const;

  constructor(
    private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")
  ) {}

  async saveOpportunity(opportunity: LoopOpportunity): Promise<void> {
    const parsed = loopOpportunitySchema.parse(opportunity);
    await writeJsonAtomic(this.opportunityPath(parsed.id), parsed);
  }

  async getOpportunity(
    opportunityId: string
  ): Promise<LoopOpportunity | undefined> {
    return readJson(this.opportunityPath(opportunityId), loopOpportunitySchema);
  }

  async listOpportunities(
    filters: LoopOpportunityFilters = {}
  ): Promise<LoopOpportunity[]> {
    const opportunities = await listJson(
      this.opportunitiesRoot(),
      loopOpportunitySchema
    );
    return opportunities
      .filter((item) => !filters.status || item.status === filters.status)
      .filter(
        (item) => !filters.department || item.department === filters.department
      )
      .filter(
        (item) =>
          filters.minimumScore === undefined ||
          item.score.total >= filters.minimumScore
      )
      .sort(
        (left, right) =>
          right.score.total - left.score.total ||
          right.updatedAt.localeCompare(left.updatedAt)
      );
  }

  async saveGraphChangeSet(changeSet: GraphChangeSet): Promise<void> {
    const parsed = graphChangeSetSchema.parse(changeSet);
    await writeJsonAtomic(this.graphChangeSetPath(parsed.id), parsed);
  }

  async getGraphChangeSet(
    changeSetId: string
  ): Promise<GraphChangeSet | undefined> {
    return readJson(this.graphChangeSetPath(changeSetId), graphChangeSetSchema);
  }

  async listGraphChangeSets(opportunityId?: string): Promise<GraphChangeSet[]> {
    const sets = await listJson(this.graphChangeSetsRoot(), graphChangeSetSchema);
    return sets
      .filter((item) => !opportunityId || item.opportunityId === opportunityId)
      .sort(
        (left, right) =>
          right.version - left.version ||
          right.updatedAt.localeCompare(left.updatedAt)
      );
  }

  private opportunitiesRoot() {
    return path.join(this.loopgraphRoot, "opportunities");
  }

  private opportunityPath(opportunityId: string) {
    return path.join(
      this.opportunitiesRoot(),
      `${safeFileName(opportunityId)}.json`
    );
  }

  private graphChangeSetsRoot() {
    return path.join(this.loopgraphRoot, "graph", "change-sets");
  }

  private graphChangeSetPath(changeSetId: string) {
    return path.join(
      this.graphChangeSetsRoot(),
      `${safeFileName(changeSetId)}.json`
    );
  }
}

async function readJson<T>(
  filePath: string,
  schema: { parse(value: unknown): T }
): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

async function listJson<T>(
  directory: string,
  schema: { parse(value: unknown): T }
): Promise<T[]> {
  try {
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const values: T[] = [];
    for (const file of files) {
      const value = await readJson(path.join(directory, file), schema);
      if (value !== undefined) values.push(value);
    }
    return values;
  } catch {
    return [];
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporaryPath, filePath);
}

function safeFileName(value: string) {
  return encodeURIComponent(value);
}
