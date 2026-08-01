import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  METRIC_BINDINGS_FILE_SCHEMA_VERSION,
  connectionReconciliationReportSchema,
  measurementJobSchema,
  metricBindingSchema,
  metricBindingsFileSchema,
  type ConnectionReconciliationReport,
  type MeasurementJob,
  type MetricBinding
} from "../core";

export type MeasurementJobFilters = {
  bindingId?: string;
  loopId?: string;
  connectionInstanceId?: string;
  status?: MeasurementJob["status"];
  dueBefore?: string;
};

export class FileMeasurementStore {
  constructor(private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")) {}

  async listMetricBindings(loopId?: string): Promise<MetricBinding[]> {
    const bindings = await this.readBindings();
    return bindings
      .filter((binding) => !loopId || binding.loopId === loopId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async getMetricBinding(bindingId: string): Promise<MetricBinding | undefined> {
    return (await this.readBindings()).find((binding) => binding.id === bindingId);
  }

  async saveMetricBinding(binding: MetricBinding, expectedRevision?: number): Promise<MetricBinding> {
    return this.withLock("bindings", async () => {
      const bindings = await this.readBindings();
      const existing = bindings.find((candidate) => candidate.id === binding.id);
      if (expectedRevision !== undefined && (existing?.revision ?? 0) !== expectedRevision) {
        throw new Error(
          `Metric binding revision conflict: expected ${expectedRevision}, current ${existing?.revision ?? 0}`
        );
      }
      const parsed = metricBindingSchema.parse(binding);
      await writeJsonAtomic(this.bindingsPath(), {
        schemaVersion: METRIC_BINDINGS_FILE_SCHEMA_VERSION,
        bindings: [
          ...bindings.filter((candidate) => candidate.id !== parsed.id),
          parsed
        ].sort((left, right) => left.id.localeCompare(right.id))
      });
      return parsed;
    });
  }

  async saveMeasurementJob(job: MeasurementJob): Promise<MeasurementJob> {
    const parsed = measurementJobSchema.parse(job);
    await writeJsonAtomic(this.jobPath(job.id), parsed);
    return parsed;
  }

  async getMeasurementJob(jobId: string): Promise<MeasurementJob | undefined> {
    return readJson(this.jobPath(jobId), measurementJobSchema);
  }

  async listMeasurementJobs(filters: MeasurementJobFilters = {}): Promise<MeasurementJob[]> {
    const jobs = await listJson(this.jobsRoot(), measurementJobSchema);
    return jobs
      .filter((job) => !filters.bindingId || job.bindingId === filters.bindingId)
      .filter((job) => !filters.loopId || job.loopId === filters.loopId)
      .filter((job) => !filters.connectionInstanceId || job.connectorInstanceId === filters.connectionInstanceId)
      .filter((job) => !filters.status || job.status === filters.status)
      .filter((job) => !filters.dueBefore || job.dueAt <= filters.dueBefore)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id));
  }

  async saveReconciliationReport(report: ConnectionReconciliationReport): Promise<ConnectionReconciliationReport> {
    const parsed = connectionReconciliationReportSchema.parse(report);
    await writeJsonAtomic(this.reconciliationPath(report.id), parsed);
    return parsed;
  }

  async getReconciliationReport(reportId: string): Promise<ConnectionReconciliationReport | undefined> {
    return readJson(this.reconciliationPath(reportId), connectionReconciliationReportSchema);
  }

  async listReconciliationReports(): Promise<ConnectionReconciliationReport[]> {
    const reports = await listJson(this.reconciliationsRoot(), connectionReconciliationReportSchema);
    return reports.sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));
  }

  async withJobLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLock("jobs", operation);
  }

  private async readBindings(): Promise<MetricBinding[]> {
    try {
      return metricBindingsFileSchema.parse(JSON.parse(await readFile(this.bindingsPath(), "utf8"))).bindings;
    } catch (error) {
      if (isFileNotFoundError(error)) return [];
      throw error;
    }
  }

  private async withLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.measurementsRoot(), { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.measurementsRoot(), `.${name}.lock`);
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
        if (Date.now() - startedAt >= 5_000) throw new Error(`Timed out waiting for measurement ${name} lock`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private measurementsRoot() {
    return path.join(this.loopgraphRoot, "measurements");
  }

  private bindingsPath() {
    return path.join(this.measurementsRoot(), "bindings.json");
  }

  private jobsRoot() {
    return path.join(this.measurementsRoot(), "jobs");
  }

  private reconciliationsRoot() {
    return path.join(this.measurementsRoot(), "reconciliation");
  }

  private jobPath(jobId: string) {
    return path.join(this.jobsRoot(), `${safeFileName(jobId)}.json`);
  }

  private reconciliationPath(reportId: string) {
    return path.join(this.reconciliationsRoot(), `${safeFileName(reportId)}.json`);
  }
}

async function readJson<T>(filePath: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isFileNotFoundError(error)) return undefined;
    throw error;
  }
}

async function listJson<T>(directory: string, schema: { parse(value: unknown): T }): Promise<T[]> {
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const values: T[] = [];
    for (const file of files) {
      const value = await readJson(path.join(directory, file), schema);
      if (value !== undefined) values.push(value);
    }
    return values;
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function safeFileName(value: string): string {
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("Measurement record ID is invalid");
  }
  return encodeURIComponent(value);
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function isStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs > staleAfterMs;
  } catch {
    return false;
  }
}
