import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./adapters";
import type { LoopRunTrace } from "../core/trace";
import type { HumanReviewTrace } from "../core/review";
import type { EscalationCase } from "../core/escalation";

export class FileStorageAdapter implements StorageAdapter {
  constructor(private rootDir = path.join(process.cwd(), ".loopgraph")) {}

  private tracePath(runId: string) {
    return path.join(this.rootDir, "traces", `${runId}.json`);
  }

  private reviewPath(reviewId: string) {
    return path.join(this.rootDir, "reviews", `${reviewId}.json`);
  }

  private casePath(caseId: string) {
    return path.join(this.rootDir, "cases", `${caseId}.json`);
  }

  private indexPath() {
    return path.join(this.rootDir, "index.json");
  }

  async ensureDirs() {
    await mkdir(path.join(this.rootDir, "traces"), { recursive: true });
    await mkdir(path.join(this.rootDir, "reviews"), { recursive: true });
    await mkdir(path.join(this.rootDir, "cases"), { recursive: true });
  }

  async saveRun(trace: LoopRunTrace): Promise<void> {
    await this.ensureDirs();
    await writeFile(this.tracePath(trace.id), JSON.stringify(trace, null, 2));
    const index = await this.readIndex();
    index.runs = index.runs.filter((item) => item.id !== trace.id);
    index.runs.unshift({ id: trace.id, loopId: trace.loopId, status: trace.status });
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2));
  }

  async getRun(runId: string): Promise<LoopRunTrace | null> {
    try {
      const raw = await readFile(this.tracePath(runId), "utf8");
      return JSON.parse(raw) as LoopRunTrace;
    } catch {
      return null;
    }
  }

  async saveReview(review: HumanReviewTrace): Promise<void> {
    await this.ensureDirs();
    await writeFile(this.reviewPath(review.id), JSON.stringify(review, null, 2));
  }

  async saveEscalationCase(caseItem: EscalationCase): Promise<void> {
    await this.ensureDirs();
    await writeFile(this.casePath(caseItem.id), JSON.stringify(caseItem, null, 2));
    const index = await this.readIndex();
    index.cases = index.cases.filter((item) => item.id !== caseItem.id);
    index.cases.unshift({ id: caseItem.id, sourceLoopId: caseItem.sourceLoopId, severity: caseItem.severity, status: caseItem.status });
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2));
  }

  async getEscalationCase(caseId: string): Promise<EscalationCase | null> {
    try {
      const raw = await readFile(this.casePath(caseId), "utf8");
      return JSON.parse(raw) as EscalationCase;
    } catch {
      return null;
    }
  }

  async listRuns(): Promise<Array<{ id: string; loopId: string; status: string }>> {
    const index = await this.readIndex();
    return index.runs;
  }

  async listCases(): Promise<Array<{ id: string; sourceLoopId: string; severity: string; status: string }>> {
    const index = await this.readIndex();
    return index.cases;
  }

  private async readIndex(): Promise<{ runs: Array<{ id: string; loopId: string; status: string }>; cases: Array<{ id: string; sourceLoopId: string; severity: string; status: string }> }> {
    try {
      const raw = await readFile(this.indexPath(), "utf8");
      return JSON.parse(raw);
    } catch {
      return { runs: [], cases: [] };
    }
  }
}

export async function listTraceFiles(rootDir = path.join(process.cwd(), ".loopgraph")): Promise<string[]> {
  try {
    const files = await readdir(path.join(rootDir, "traces"));
    return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
