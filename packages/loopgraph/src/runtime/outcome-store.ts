import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  contentHash,
  metricSampleSchema,
  observedOutcomeSchema,
  valueLedgerEntrySchema,
  type MetricSample,
  type ObservedOutcome,
  type ValueLedgerEntry
} from "../core";

export type OutcomeStoreSaveResult<T> = {
  record: T;
  duplicate: boolean;
};

export type MetricSampleFilters = {
  workspaceId?: string;
  companyId?: string;
  departmentId?: string;
  loopId?: string;
  metricDefinitionId?: string;
  metricKey?: string;
  windowStart?: string;
  windowEnd?: string;
};

export type ObservedOutcomeFilters = {
  workspaceId?: string;
  companyId?: string;
  departmentId?: string;
  loopId?: string;
  metricDefinitionId?: string;
  status?: ObservedOutcome["status"];
};

export type ValueLedgerFilters = {
  workspaceId?: string;
  companyId?: string;
  departmentId?: string;
  loopId?: string;
  windowStart?: string;
  windowEnd?: string;
};

export interface OutcomeStore {
  saveMetricSample(sample: MetricSample): Promise<OutcomeStoreSaveResult<MetricSample>>;
  getMetricSample(sampleId: string): Promise<MetricSample | undefined>;
  listMetricSamples(filters?: MetricSampleFilters): Promise<MetricSample[]>;
  saveObservedOutcome(outcome: ObservedOutcome): Promise<OutcomeStoreSaveResult<ObservedOutcome>>;
  getObservedOutcome(outcomeId: string): Promise<ObservedOutcome | undefined>;
  listObservedOutcomes(filters?: ObservedOutcomeFilters): Promise<ObservedOutcome[]>;
  saveValueLedgerEntry(entry: ValueLedgerEntry): Promise<OutcomeStoreSaveResult<ValueLedgerEntry>>;
  getValueLedgerEntry(entryId: string): Promise<ValueLedgerEntry | undefined>;
  listValueLedgerEntries(filters?: ValueLedgerFilters): Promise<ValueLedgerEntry[]>;
}

export class FileOutcomeStore implements OutcomeStore {
  constructor(private readonly loopgraphRoot = path.join(process.cwd(), ".loopgraph")) {}

  async saveMetricSample(sample: MetricSample): Promise<OutcomeStoreSaveResult<MetricSample>> {
    const parsed = metricSampleSchema.parse(sample);
    return saveIdempotentRecord({
      filePath: this.metricSamplePath(parsed.id),
      record: parsed,
      parse: (value) => metricSampleSchema.parse(value),
      comparable: withoutKeys("recordedAt"),
      label: "Metric sample"
    });
  }

  async getMetricSample(sampleId: string): Promise<MetricSample | undefined> {
    return readRecord(this.metricSamplePath(sampleId), (value) => metricSampleSchema.parse(value));
  }

  async listMetricSamples(filters: MetricSampleFilters = {}): Promise<MetricSample[]> {
    const records = await listRecords(this.metricSamplesRoot(), (value) => metricSampleSchema.parse(value));
    return records
      .filter((sample) => !filters.workspaceId || sample.workspaceId === filters.workspaceId)
      .filter((sample) => !filters.companyId || sample.companyId === filters.companyId)
      .filter((sample) => !filters.departmentId || sample.departmentId === filters.departmentId)
      .filter((sample) => !filters.loopId || sample.loopId === filters.loopId)
      .filter((sample) => !filters.metricDefinitionId || sample.metricDefinitionId === filters.metricDefinitionId)
      .filter((sample) => !filters.metricKey || sample.metricKey === filters.metricKey)
      .filter((sample) => !filters.windowStart || sample.window.end >= filters.windowStart)
      .filter((sample) => !filters.windowEnd || sample.window.start <= filters.windowEnd)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id));
  }

  async saveObservedOutcome(outcome: ObservedOutcome): Promise<OutcomeStoreSaveResult<ObservedOutcome>> {
    const parsed = observedOutcomeSchema.parse(outcome);
    return saveIdempotentRecord({
      filePath: this.observedOutcomePath(parsed.id),
      record: parsed,
      parse: (value) => observedOutcomeSchema.parse(value),
      comparable: withoutKeys("evaluatedAt"),
      label: "Observed outcome"
    });
  }

  async getObservedOutcome(outcomeId: string): Promise<ObservedOutcome | undefined> {
    return readRecord(this.observedOutcomePath(outcomeId), (value) => observedOutcomeSchema.parse(value));
  }

  async listObservedOutcomes(filters: ObservedOutcomeFilters = {}): Promise<ObservedOutcome[]> {
    const records = await listRecords(this.observedOutcomesRoot(), (value) => observedOutcomeSchema.parse(value));
    return records
      .filter((outcome) => !filters.workspaceId || outcome.workspaceId === filters.workspaceId)
      .filter((outcome) => !filters.companyId || outcome.companyId === filters.companyId)
      .filter((outcome) => !filters.departmentId || outcome.departmentId === filters.departmentId)
      .filter((outcome) => !filters.loopId || outcome.loopId === filters.loopId)
      .filter((outcome) => !filters.metricDefinitionId || outcome.metricDefinitionId === filters.metricDefinitionId)
      .filter((outcome) => !filters.status || outcome.status === filters.status)
      .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt) || left.id.localeCompare(right.id));
  }

  async saveValueLedgerEntry(entry: ValueLedgerEntry): Promise<OutcomeStoreSaveResult<ValueLedgerEntry>> {
    const parsed = valueLedgerEntrySchema.parse(entry);
    return saveIdempotentRecord({
      filePath: this.valueLedgerEntryPath(parsed.id),
      record: parsed,
      parse: (value) => valueLedgerEntrySchema.parse(value),
      comparable: withoutKeys("recordedAt"),
      label: "Value ledger entry"
    });
  }

  async getValueLedgerEntry(entryId: string): Promise<ValueLedgerEntry | undefined> {
    return readRecord(this.valueLedgerEntryPath(entryId), (value) => valueLedgerEntrySchema.parse(value));
  }

  async listValueLedgerEntries(filters: ValueLedgerFilters = {}): Promise<ValueLedgerEntry[]> {
    const records = await listRecords(this.valueLedgerRoot(), (value) => valueLedgerEntrySchema.parse(value));
    return records
      .filter((entry) => !filters.workspaceId || entry.workspaceId === filters.workspaceId)
      .filter((entry) => !filters.companyId || entry.companyId === filters.companyId)
      .filter((entry) => !filters.departmentId || entry.departmentId === filters.departmentId)
      .filter((entry) => !filters.loopId || entry.loopId === filters.loopId)
      .filter((entry) => !filters.windowStart || entry.window.end >= filters.windowStart)
      .filter((entry) => !filters.windowEnd || entry.window.start <= filters.windowEnd)
      .sort((left, right) => right.window.end.localeCompare(left.window.end) || left.id.localeCompare(right.id));
  }

  async pruneMetricSamples(input: {
    olderThan: string;
    preserveReferenced?: boolean;
  }): Promise<{
    schemaVersion: "outcome-retention/v1alpha1";
    olderThan: string;
    removedSampleIds: string[];
    preservedReferencedSampleIds: string[];
  }> {
    const cutoff = new Date(input.olderThan);
    if (Number.isNaN(cutoff.getTime())) throw new Error("olderThan must be an ISO timestamp");
    const samples = await this.listMetricSamples();
    const referenced = new Set<string>();
    if (input.preserveReferenced !== false) {
      for (const outcome of await this.listObservedOutcomes()) {
        for (const sampleId of outcome.baseline?.sampleIds ?? []) referenced.add(sampleId);
        for (const sampleId of outcome.observed?.sampleIds ?? []) referenced.add(sampleId);
      }
    }
    const removedSampleIds: string[] = [];
    const preservedReferencedSampleIds: string[] = [];
    for (const sample of samples) {
      if (Date.parse(sample.observedAt) >= cutoff.getTime()) continue;
      if (referenced.has(sample.id)) {
        preservedReferencedSampleIds.push(sample.id);
        continue;
      }
      await unlink(this.metricSamplePath(sample.id));
      removedSampleIds.push(sample.id);
    }
    return {
      schemaVersion: "outcome-retention/v1alpha1",
      olderThan: cutoff.toISOString(),
      removedSampleIds: removedSampleIds.sort(),
      preservedReferencedSampleIds: preservedReferencedSampleIds.sort()
    };
  }

  private outcomesRoot() {
    return path.join(this.loopgraphRoot, "outcomes");
  }

  private metricSamplesRoot() {
    return path.join(this.outcomesRoot(), "metric-samples");
  }

  private observedOutcomesRoot() {
    return path.join(this.outcomesRoot(), "observed");
  }

  private valueLedgerRoot() {
    return path.join(this.outcomesRoot(), "value-ledger");
  }

  private metricSamplePath(sampleId: string) {
    return path.join(this.metricSamplesRoot(), `${safeRecordFileName(sampleId)}.json`);
  }

  private observedOutcomePath(outcomeId: string) {
    return path.join(this.observedOutcomesRoot(), `${safeRecordFileName(outcomeId)}.json`);
  }

  private valueLedgerEntryPath(entryId: string) {
    return path.join(this.valueLedgerRoot(), `${safeRecordFileName(entryId)}.json`);
  }
}

async function saveIdempotentRecord<T>(input: {
  filePath: string;
  record: T;
  parse: (value: unknown) => T;
  comparable: (value: T) => unknown;
  label: string;
}): Promise<OutcomeStoreSaveResult<T>> {
  const existing = await readRecord(input.filePath, input.parse);
  if (existing) {
    if (contentHash(input.comparable(existing)) !== contentHash(input.comparable(input.record))) {
      throw new Error(`${input.label} idempotency conflict for ${path.basename(input.filePath, ".json")}`);
    }
    return { record: existing, duplicate: true };
  }
  await writeJsonAtomic(input.filePath, input.record);
  return { record: input.record, duplicate: false };
}

function withoutKeys<T extends Record<string, unknown>>(...keys: string[]) {
  return (value: T) => {
    const comparable = { ...value };
    for (const key of keys) delete comparable[key];
    return comparable;
  };
}

async function readRecord<T>(filePath: string, parse: (value: unknown) => T): Promise<T | undefined> {
  try {
    return parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return undefined;
  }
}

async function listRecords<T>(directory: string, parse: (value: unknown) => T): Promise<T[]> {
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    const records: T[] = [];
    for (const file of files) {
      const record = await readRecord(path.join(directory, file), parse);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function safeRecordFileName(id: string): string {
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw new Error("Outcome record ID is invalid");
  }
  return encodeURIComponent(id);
}
