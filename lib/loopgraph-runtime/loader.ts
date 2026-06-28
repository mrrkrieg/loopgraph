import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { validateLoopSpec, type LoopSpec } from "../loopgraph-core/loop-spec";

export type LoadResult =
  | { ok: true; spec: LoopSpec; sourcePath: string }
  | { ok: false; errors: string[]; sourcePath: string };

export async function loadLoopSpecFromPath(specPath: string): Promise<LoadResult> {
  const absolute = path.resolve(specPath);
  const isDir = !specPath.endsWith(".yaml") && !specPath.endsWith(".json");
  const filePath = isDir ? path.join(absolute, "loopgraph.yaml") : absolute;

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = filePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
    const spec = validateLoopSpec(parsed);
    return { ok: true, spec, sourcePath: filePath };
  } catch (error) {
    if (error instanceof Error && "mark" in error) {
      const yamlError = error as Error & { mark?: { line: number; column: number } };
      const loc = yamlError.mark ? ` at line ${yamlError.mark.line + 1}, column ${yamlError.mark.column + 1}` : "";
      return { ok: false, errors: [`${yamlError.message}${loc}`], sourcePath: filePath };
    }
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      sourcePath: filePath
    };
  }
}
