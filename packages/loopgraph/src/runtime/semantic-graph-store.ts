import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  graphChangeApprovalReceiptSchema,
  graphSnapshotSchema,
  graphTransactionSchema,
  loopPromotionReceiptSchema,
  promotionRehearsalReportSchema,
  type GraphChangeSet,
  type GraphChangeApprovalReceipt,
  type GraphSnapshot,
  type GraphTransaction,
  type LoopPromotionReceipt,
  type PromotionRehearsalReport
} from "../core";
import type {
  StoredLoopSpecArtifact
} from "./loop-spec-store";
import type { LoopgraphWorkspaceRegistry } from "./workspace";

export type SemanticGraphMutationCommitInput = {
  commitId: string;
  idempotencyKey: string;
  projectRoot: string;
  expectedWorkspaceRevision: number;
  expectedArtifacts: Array<{ loopId: string; versionHash: string }>;
  committedAt: string;
  workspace: LoopgraphWorkspaceRegistry;
  artifacts: StoredLoopSpecArtifact[];
  baseSnapshot: GraphSnapshot;
  resultSnapshot: GraphSnapshot;
  transaction: GraphTransaction;
  changeSet?: GraphChangeSet;
  promotion?: LoopPromotionReceipt;
  transactionUpdates?: GraphTransaction[];
  promotionUpdates?: LoopPromotionReceipt[];
};

export type SemanticGraphMutationCommitResult = {
  workspaceRevision: number;
  transaction: GraphTransaction;
  promotion?: LoopPromotionReceipt;
  created: boolean;
};

export interface SemanticGraphStore {
  readonly persistence: "file" | "distributed";
  normalizeArtifacts(
    artifacts: StoredLoopSpecArtifact[]
  ): StoredLoopSpecArtifact[];
  saveSnapshot(snapshot: GraphSnapshot): Promise<void>;
  getSnapshot(snapshotId: string): Promise<GraphSnapshot | undefined>;
  listSnapshots(): Promise<GraphSnapshot[]>;
  saveApproval(receipt: GraphChangeApprovalReceipt): Promise<void>;
  getApproval(
    receiptId: string
  ): Promise<GraphChangeApprovalReceipt | undefined>;
  listApprovals(
    changeSetId?: string
  ): Promise<GraphChangeApprovalReceipt[]>;
  saveTransaction(transaction: GraphTransaction): Promise<void>;
  getTransaction(
    transactionId: string
  ): Promise<GraphTransaction | undefined>;
  listTransactions(): Promise<GraphTransaction[]>;
  savePromotion(receipt: LoopPromotionReceipt): Promise<void>;
  getPromotion(
    receiptId: string
  ): Promise<LoopPromotionReceipt | undefined>;
  listPromotions(loopId?: string): Promise<LoopPromotionReceipt[]>;
  savePromotionRehearsal(
    report: PromotionRehearsalReport
  ): Promise<void>;
  getPromotionRehearsal(
    reportId: string
  ): Promise<PromotionRehearsalReport | undefined>;
  listPromotionRehearsals(
    loopId?: string
  ): Promise<PromotionRehearsalReport[]>;
  withTransactionLock<T>(operation: () => Promise<T>): Promise<T>;
  commitGraphMutationAtomically?(
    input: SemanticGraphMutationCommitInput
  ): Promise<SemanticGraphMutationCommitResult>;
  snapshotAssetsRoot?(snapshotId: string): string;
}

export class FileSemanticGraphStore implements SemanticGraphStore {
  readonly persistence = "file" as const;

  constructor(private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")) {}

  normalizeArtifacts(
    artifacts: StoredLoopSpecArtifact[]
  ): StoredLoopSpecArtifact[] {
    return artifacts;
  }

  async saveSnapshot(snapshot: GraphSnapshot): Promise<void> {
    await writeJsonAtomic(this.snapshotPath(snapshot.id), graphSnapshotSchema.parse(snapshot));
  }

  async getSnapshot(snapshotId: string): Promise<GraphSnapshot | undefined> {
    return readJson(this.snapshotPath(snapshotId), graphSnapshotSchema);
  }

  async listSnapshots(): Promise<GraphSnapshot[]> {
    return listJson(this.snapshotsRoot(), graphSnapshotSchema, (left, right) =>
      left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt)
    );
  }

  async saveApproval(receipt: GraphChangeApprovalReceipt): Promise<void> {
    await writeJsonAtomic(this.approvalPath(receipt.id), graphChangeApprovalReceiptSchema.parse(receipt));
  }

  async getApproval(receiptId: string): Promise<GraphChangeApprovalReceipt | undefined> {
    return readJson(this.approvalPath(receiptId), graphChangeApprovalReceiptSchema);
  }

  async listApprovals(changeSetId?: string): Promise<GraphChangeApprovalReceipt[]> {
    const receipts = await listJson(
      this.approvalsRoot(),
      graphChangeApprovalReceiptSchema,
      (left, right) => left.decidedAt.localeCompare(right.decidedAt)
    );
    return receipts.filter((receipt) => !changeSetId || receipt.changeSetId === changeSetId);
  }

  async saveTransaction(transaction: GraphTransaction): Promise<void> {
    await writeJsonAtomic(this.transactionPath(transaction.id), graphTransactionSchema.parse(transaction));
  }

  async getTransaction(transactionId: string): Promise<GraphTransaction | undefined> {
    return readJson(this.transactionPath(transactionId), graphTransactionSchema);
  }

  async listTransactions(): Promise<GraphTransaction[]> {
    return listJson(this.transactionsRoot(), graphTransactionSchema, (left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  async savePromotion(receipt: LoopPromotionReceipt): Promise<void> {
    await writeJsonAtomic(this.promotionPath(receipt.id), loopPromotionReceiptSchema.parse(receipt));
  }

  async getPromotion(receiptId: string): Promise<LoopPromotionReceipt | undefined> {
    return readJson(this.promotionPath(receiptId), loopPromotionReceiptSchema);
  }

  async listPromotions(loopId?: string): Promise<LoopPromotionReceipt[]> {
    const receipts = await listJson(
      this.promotionsRoot(),
      loopPromotionReceiptSchema,
      (left, right) => right.promotedAt.localeCompare(left.promotedAt)
    );
    return receipts.filter((receipt) => !loopId || receipt.loopId === loopId);
  }

  async savePromotionRehearsal(report: PromotionRehearsalReport): Promise<void> {
    await writeJsonAtomic(
      this.promotionRehearsalPath(report.id),
      promotionRehearsalReportSchema.parse(report)
    );
  }

  async getPromotionRehearsal(reportId: string): Promise<PromotionRehearsalReport | undefined> {
    return readJson(this.promotionRehearsalPath(reportId), promotionRehearsalReportSchema);
  }

  async listPromotionRehearsals(loopId?: string): Promise<PromotionRehearsalReport[]> {
    const reports = await listJson(
      this.promotionRehearsalsRoot(),
      promotionRehearsalReportSchema,
      (left, right) => right.createdAt.localeCompare(left.createdAt)
    );
    return reports.filter((report) => !loopId || report.loopId === loopId);
  }

  async withTransactionLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureDirs();
    const lockPath = path.join(this.graphRoot(), ".transactions.lock");
    const startedAt = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    while (!handle) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        if (await isStaleLock(lockPath, 60_000)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - startedAt >= 5_000) {
          throw new Error("Timed out waiting for the semantic graph transaction lock");
        }
        await wait(10);
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  snapshotAssetsRoot(snapshotId: string) {
    return path.join(this.snapshotsRoot(), `${safeFileName(snapshotId)}.assets`);
  }

  private async ensureDirs() {
    await Promise.all([
      mkdir(this.snapshotsRoot(), { recursive: true, mode: 0o700 }),
      mkdir(this.approvalsRoot(), { recursive: true, mode: 0o700 }),
      mkdir(this.transactionsRoot(), { recursive: true, mode: 0o700 }),
      mkdir(this.promotionsRoot(), { recursive: true, mode: 0o700 }),
      mkdir(this.promotionRehearsalsRoot(), { recursive: true, mode: 0o700 })
    ]);
  }

  private graphRoot() {
    return path.join(this.loopgraphRoot, "graph");
  }

  private snapshotsRoot() {
    return path.join(this.graphRoot(), "snapshots");
  }

  private approvalsRoot() {
    return path.join(this.graphRoot(), "approvals");
  }

  private transactionsRoot() {
    return path.join(this.graphRoot(), "transactions");
  }

  private promotionsRoot() {
    return path.join(this.graphRoot(), "promotions");
  }

  private promotionRehearsalsRoot() {
    return path.join(this.graphRoot(), "rehearsals");
  }

  private snapshotPath(id: string) {
    return path.join(this.snapshotsRoot(), `${safeFileName(id)}.json`);
  }

  private approvalPath(id: string) {
    return path.join(this.approvalsRoot(), `${safeFileName(id)}.json`);
  }

  private transactionPath(id: string) {
    return path.join(this.transactionsRoot(), `${safeFileName(id)}.json`);
  }

  private promotionPath(id: string) {
    return path.join(this.promotionsRoot(), `${safeFileName(id)}.json`);
  }

  private promotionRehearsalPath(id: string) {
    return path.join(this.promotionRehearsalsRoot(), `${safeFileName(id)}.json`);
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
  schema: { parse(value: unknown): T },
  compare: (left: T, right: T) => number
): Promise<T[]> {
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const values: T[] = [];
    for (const file of files) {
      const value = await readJson(path.join(directory, file), schema);
      if (value !== undefined) values.push(value);
    }
    return values.sort(compare);
  } catch {
    return [];
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function safeFileName(value: string) {
  return encodeURIComponent(value);
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
