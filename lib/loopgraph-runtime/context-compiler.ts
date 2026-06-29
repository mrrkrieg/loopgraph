import type { LoopSpec } from "../loopgraph-core/loop-spec";
import type { ContextSnapshot, ContextSnapshotEntry } from "../loopgraph-core/context";
import { contentHash } from "../loopgraph-core/hash";
import { allMockAdapters } from "../loopgraph-sdk/adapters/mock-adapters";
import type { SimulationFixture } from "./fixture-loader";

export async function compileContextSnapshot(input: {
  spec: LoopSpec;
  fixture: SimulationFixture;
}): Promise<ContextSnapshot> {
  const entries: ContextSnapshotEntry[] = [];
  const simulatedAt = input.fixture.simulatedAt;

  for (const source of input.spec.context.sources) {
    const adapter = allMockAdapters.find((item) => item.id === source.adapterId);
    let value: unknown = null;
    let trusted = source.trusted;
    let freshness: ContextSnapshotEntry["freshness"] = "fixture";

    if (adapter && source.variableKey) {
      const variable = await adapter.readVariable(source.variableKey, input.fixture as Record<string, unknown>);
      value = variable.value;
      trusted = variable.trusted;
      freshness = variable.freshness;
    } else if (source.type === "policy") {
      value = { note: "Global system policy", untrustedInstructionIgnored: true };
      trusted = true;
    }

    entries.push({
      sourceId: source.id,
      sourceType: source.type,
      title: source.title,
      value,
      retrievedAt: simulatedAt,
      freshness,
      sensitivity: source.sensitivity,
      trusted,
      redactionApplied: source.sensitivity === "restricted" && input.spec.context.redactionPolicy !== "none",
      contentHash: contentHash(value),
      precedence: source.precedence
    });
  }

  entries.sort((a, b) => a.precedence - b.precedence);

  const snapshotBody = {
    loopId: input.spec.metadata.id,
    loopSpecVersion: input.spec.metadata.version,
    createdAt: simulatedAt,
    entries
  };

  return {
    id: `ctx_${contentHash(snapshotBody)}`,
    loopId: input.spec.metadata.id,
    loopSpecVersion: input.spec.metadata.version,
    createdAt: simulatedAt,
    tokenEstimate: entries.reduce((sum, entry) => sum + JSON.stringify(entry.value ?? "").length, 0),
    contentHash: contentHash(snapshotBody),
    entries,
    compiledPrompt: entries.map((entry) => `# ${entry.title}\n${JSON.stringify(entry.value)}`).join("\n\n")
  };
}
