import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "../sdk/adapters";
import { consumeEscalationCase, type ManagementPlan } from "./management-consumer";
import { getLoopgraphRoot } from "./storage-resolver";

export type ManagementRollupPlan = {
  caseId: string;
  summary: string;
  severity: string;
  plan: ManagementPlan;
};

export type ManagementRollup = {
  id: string;
  generatedAt: string;
  weekKey: string;
  openCases: number;
  plans: ManagementRollupPlan[];
  decisionsNeeded: string[];
};

function weekKeyForDate(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function managementDir(rootDir: string) {
  return path.join(rootDir, "management");
}

export async function generateManagementRollup(storage: StorageAdapter): Promise<ManagementRollup> {
  const cases = await storage.listCases();
  const open = cases.filter((item) => item.status === "open" || item.status === "under_review");
  const plans: ManagementRollupPlan[] = [];

  for (const item of open) {
    const caseItem = await storage.getEscalationCase(item.id);
    if (!caseItem) {
      continue;
    }

    plans.push({
      caseId: caseItem.id,
      summary: caseItem.summary,
      severity: caseItem.severity,
      plan: consumeEscalationCase(caseItem)
    });
  }

  const generatedAt = new Date().toISOString();
  const weekKey = weekKeyForDate(new Date(generatedAt));

  return {
    id: `rollup_${weekKey}_${generatedAt.slice(0, 10)}`,
    generatedAt,
    weekKey,
    openCases: open.length,
    plans,
    decisionsNeeded: plans.filter((entry) => entry.plan.leadershipDecisionRequired).map((entry) => entry.summary)
  };
}

export async function persistManagementRollup(rollup: ManagementRollup, rootDir = getLoopgraphRoot()) {
  const dir = managementDir(rootDir);
  await mkdir(dir, { recursive: true });
  const serialized = `${JSON.stringify(rollup, null, 2)}\n`;
  await writeFile(path.join(dir, "latest.json"), serialized);
  await writeFile(path.join(dir, `${rollup.weekKey}.json`), serialized);
}

export async function loadLatestManagementRollup(rootDir = getLoopgraphRoot()): Promise<ManagementRollup | null> {
  try {
    const raw = await readFile(path.join(managementDir(rootDir), "latest.json"), "utf8");
    return JSON.parse(raw) as ManagementRollup;
  } catch {
    return null;
  }
}

export async function listManagementRollups(rootDir = getLoopgraphRoot()): Promise<ManagementRollup[]> {
  try {
    const files = await readdir(managementDir(rootDir));
    const rollups: ManagementRollup[] = [];

    for (const file of files.filter((name) => name.endsWith(".json") && name !== "latest.json")) {
      const raw = await readFile(path.join(managementDir(rootDir), file), "utf8");
      rollups.push(JSON.parse(raw) as ManagementRollup);
    }

    return rollups.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  } catch {
    return [];
  }
}

export async function generateAndPersistManagementRollup(storage: StorageAdapter, rootDir = getLoopgraphRoot()) {
  const rollup = await generateManagementRollup(storage);
  await persistManagementRollup(rollup, rootDir);
  return rollup;
}
