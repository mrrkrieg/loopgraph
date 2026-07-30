import { realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveExistingProjectPath(
  projectRoot: string,
  candidate: string,
  label = "project path"
): Promise<string> {
  const lexicalRoot = path.resolve(projectRoot);
  const lexicalTarget = path.resolve(lexicalRoot, candidate);
  assertPathInside(lexicalRoot, lexicalTarget, label);

  const [resolvedRoot, resolvedTarget] = await Promise.all([
    realpath(lexicalRoot),
    realpath(lexicalTarget)
  ]);
  assertPathInside(resolvedRoot, resolvedTarget, label);
  return resolvedTarget;
}

function assertPathInside(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`${label} escapes the project root`);
}
