import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { contentHash, graphEditorOperationSchema, graphEditorTransactionSchema, type GraphEditorOperation, type GraphEditorTransaction } from "../core";

export type GraphLayoutOverrides = Record<string, { x: number; y: number }>;

export class FileGraphAuthoringStore {
  constructor(private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")) {}

  async submit(input: { workspaceId: string; companyId: string; actorId: string; expectedTopologyHash: string; operations: GraphEditorOperation[]; now?: Date }) {
    const operations = input.operations.map((operation) => graphEditorOperationSchema.parse(operation));
    const semantic = operations.some((operation) => operation.kind !== "move_node");
    const transaction = graphEditorTransactionSchema.parse({
      id: `graph_edit_${randomUUID()}`,
      workspaceId: input.workspaceId,
      companyId: input.companyId,
      actorId: input.actorId,
      expectedTopologyHash: input.expectedTopologyHash,
      operations,
      status: semantic ? "proposal_pending" : "layout_applied",
      createdAt: (input.now ?? new Date()).toISOString()
    });
    await atomicWrite(path.join(this.transactionsRoot(), `${transaction.id}.json`), transaction);
    if (!semantic) {
      const layout = await this.getLayout();
      for (const operation of operations) if (operation.kind === "move_node") layout[operation.nodeId] = { x: operation.x, y: operation.y };
      await atomicWrite(this.layoutPath(), { schemaVersion: "graph-layout/v1alpha1", topologyHash: input.expectedTopologyHash, positions: layout, updatedAt: transaction.createdAt });
    }
    return transaction;
  }

  async getLayout(): Promise<GraphLayoutOverrides> {
    try {
      const parsed = JSON.parse(await readFile(this.layoutPath(), "utf8")) as { positions?: unknown };
      if (!parsed.positions || typeof parsed.positions !== "object" || Array.isArray(parsed.positions)) return {};
      const result: GraphLayoutOverrides = {};
      for (const [nodeId, value] of Object.entries(parsed.positions)) {
        if (!value || typeof value !== "object") continue;
        const position = value as { x?: unknown; y?: unknown };
        if (typeof position.x === "number" && Number.isFinite(position.x) && typeof position.y === "number" && Number.isFinite(position.y)) result[nodeId] = { x: position.x, y: position.y };
      }
      return result;
    } catch { return {}; }
  }

  async list(): Promise<GraphEditorTransaction[]> {
    try {
      const files = (await readdir(this.transactionsRoot())).filter((file) => file.endsWith(".json")).sort();
      const values: GraphEditorTransaction[] = [];
      for (const file of files) values.push(graphEditorTransactionSchema.parse(JSON.parse(await readFile(path.join(this.transactionsRoot(), file), "utf8"))));
      return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch { return []; }
  }

  private root() { return path.join(this.loopgraphRoot, "graph-authoring"); }
  private layoutPath() { return path.join(this.root(), "layout.json"); }
  private transactionsRoot() { return path.join(this.root(), "transactions"); }
}

async function atomicWrite(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${contentHash(randomUUID())}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}
