import type { LoopSpec } from "../core/loop-spec";
import type { SimulationFixture } from "./fixture-loader";
import type { StorageAdapter } from "../sdk/adapters";
import { runLoop, type RunLoopResult } from "./loop-runner";

export type SimulateResult = RunLoopResult;

export async function simulateLoop(input: {
  spec: LoopSpec;
  fixture: SimulationFixture | string;
  storage?: StorageAdapter;
}): Promise<SimulateResult> {
  const { loadFixture } = await import("./fixture-loader");
  const { FileStorageAdapter } = await import("../sdk/storage");
  const fixture = typeof input.fixture === "string" ? await loadFixture(input.fixture) : input.fixture;
  const storage = input.storage ?? new FileStorageAdapter();

  return runLoop({
    spec: input.spec,
    mode: "simulate",
    fixture,
    eventId: fixture.eventId,
    startedAt: fixture.simulatedAt,
    storage
  });
}
