import type { LoopSpec } from "../core/loop-spec";
import type { ContextSnapshot, ContextSnapshotEntry } from "../core/context";
import { contentHash } from "../core/hash";
import { allMockAdapters } from "../sdk/adapters/mock-adapters";
import { githubAdapter } from "../sdk/adapters/github";
import type { IntegrationAdapter } from "../sdk/adapters";
import type { SimulationFixture } from "./fixture-loader";

export function isGitHubAdapterConfigured() {
  const token = process.env.GITHUB_TOKEN ?? process.env.LOOPGRAPH_GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER ?? process.env.LOOPGRAPH_GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO ?? process.env.LOOPGRAPH_GITHUB_REPO;
  return Boolean(token && owner && repo);
}

function resolveAdapter(adapterId: string, mode: "simulate" | "execute"): IntegrationAdapter | undefined {
  if (mode === "execute" && adapterId === "github" && isGitHubAdapterConfigured()) {
    return githubAdapter;
  }
  return allMockAdapters.find((item) => item.id === adapterId);
}

export async function compileContextSnapshot(input: {
  spec: LoopSpec;
  fixture: SimulationFixture;
  mode?: "simulate" | "execute";
}): Promise<ContextSnapshot> {
  const mode = input.mode ?? "simulate";
  const entries: ContextSnapshotEntry[] = [];
  const simulatedAt = input.fixture.simulatedAt ?? new Date().toISOString();

  for (const source of input.spec.context.sources) {
    const adapter = source.adapterId ? resolveAdapter(source.adapterId, mode) : undefined;
    let value: unknown = null;
    let trusted = source.trusted;
    let freshness: ContextSnapshotEntry["freshness"] = mode === "execute" ? "realtime" : "fixture";

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
