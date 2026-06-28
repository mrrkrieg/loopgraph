import { readFile } from "node:fs/promises";
import path from "node:path";

export type SimulationFixture = {
  eventId: string;
  simulatedAt: string;
  trigger?: Record<string, unknown>;
  issue?: Record<string, unknown>;
  repo?: Record<string, unknown>;
  ticket?: Record<string, unknown>;
  account?: Record<string, unknown>;
  incident?: Record<string, unknown>;
  incidents?: Record<string, unknown>;
  businessImpact?: Record<string, unknown>;
  usage_30d?: Record<string, unknown>;
  expectedAssessment?: Record<string, unknown>;
  contextOverrides?: Record<string, unknown>;
};

export async function loadFixture(fixturePath: string): Promise<SimulationFixture> {
  const raw = await readFile(path.resolve(fixturePath), "utf8");
  return JSON.parse(raw) as SimulationFixture;
}
