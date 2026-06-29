import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { getLoopgraphRoot } from "../loopgraph-runtime/storage-resolver";
import { loadLoopSpecFromPath } from "../loopgraph-runtime/loader";
import type { LoopSpec } from "../loopgraph-core/loop-spec";
import { createSpecFromTemplate } from "./template-spec";
import { getDepartmentTemplate, getTemplateById } from "./templates";
import type {
  DepartmentKey,
  LoopgraphWorkspaceRegistry,
  RegisteredLoopSpec
} from "./types";

export type LoadedRegisteredLoopSpec = RegisteredLoopSpec & {
  sourcePath: string;
  spec: LoopSpec;
};

const defaultRegistry: LoopgraphWorkspaceRegistry = {
  version: 1,
  registeredSpecs: [],
  demoCatalogEnabled: true
};

export function getWorkspaceRegistryPath(projectRoot = process.cwd()) {
  return path.join(getLoopgraphRoot(projectRoot), "workspace.json");
}

export async function readWorkspaceRegistry(projectRoot = process.cwd()): Promise<LoopgraphWorkspaceRegistry> {
  try {
    const raw = await readFile(getWorkspaceRegistryPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<LoopgraphWorkspaceRegistry>;
    return {
      version: 1,
      registeredSpecs: Array.isArray(parsed.registeredSpecs) ? parsed.registeredSpecs : [],
      demoCatalogEnabled: parsed.demoCatalogEnabled ?? true
    };
  } catch {
    return defaultRegistry;
  }
}

export async function writeWorkspaceRegistry(
  registry: LoopgraphWorkspaceRegistry,
  projectRoot = process.cwd()
) {
  const registryPath = getWorkspaceRegistryPath(projectRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

export async function registerLoopSpec(specPath: string, projectRoot = process.cwd()) {
  const absoluteSpecPath = path.resolve(projectRoot, specPath);
  const loaded = await loadLoopSpecFromPath(absoluteSpecPath);
  if (!loaded.ok) {
    throw new Error(`Cannot register LoopSpec:\n- ${loaded.errors.join("\n- ")}`);
  }

  const registry = await readWorkspaceRegistry(projectRoot);
  const entry = entryFromSpec(loaded.spec, loaded.sourcePath, projectRoot);
  const nextEntries = [
    ...registry.registeredSpecs.filter(
      (item) => item.id !== entry.id && resolveRegisteredPath(item.path, projectRoot) !== loaded.sourcePath
    ),
    entry
  ].sort((left, right) => left.name.localeCompare(right.name));

  await writeWorkspaceRegistry({
    ...registry,
    registeredSpecs: nextEntries
  }, projectRoot);

  return entry;
}

export async function getRegisteredLoopSpecs(projectRoot = process.cwd()): Promise<LoadedRegisteredLoopSpec[]> {
  const registry = await readWorkspaceRegistry(projectRoot);
  const specs: LoadedRegisteredLoopSpec[] = [];

  for (const entry of registry.registeredSpecs) {
    const sourcePath = resolveRegisteredPath(entry.path, projectRoot);
    const loaded = await loadLoopSpecFromPath(sourcePath);
    if (loaded.ok) {
      specs.push({
        ...entry,
        sourcePath: loaded.sourcePath,
        spec: loaded.spec
      });
    }
  }

  return specs;
}

export async function createLocalDesignStudioSpec(input: {
  templateId: string;
  name?: string;
  goal?: string;
  projectRoot?: string;
}) {
  const projectRoot = input.projectRoot ?? process.cwd();
  const template = getTemplateById(input.templateId);
  if (!template) {
    throw new Error(`Unknown template: ${input.templateId}`);
  }

  const id = uniqueLoopId(input.name || template.name);
  const spec = createSpecFromTemplate(input.templateId, {
    id,
    name: input.name || template.name,
    goal: input.goal
  });
  const specDir = path.join(getLoopgraphRoot(projectRoot), "design-studio", id);
  const specPath = path.join(specDir, "loopgraph.yaml");
  await mkdir(specDir, { recursive: true });
  await writeFile(specPath, YAML.stringify(spec));
  const entry = await registerLoopSpec(specPath, projectRoot);

  return {
    id,
    spec,
    path: specPath,
    entry
  };
}

function entryFromSpec(spec: LoopSpec, sourcePath: string, projectRoot: string): RegisteredLoopSpec {
  const templateId = getTemplateId(spec);
  const department = getDepartmentKey(String(spec.topology?.department ?? "custom"));

  return {
    id: spec.metadata.id,
    name: spec.metadata.name,
    path: toRegistryPath(sourcePath, projectRoot),
    templateId,
    department,
    addedAt: new Date().toISOString()
  };
}

function getTemplateId(spec: LoopSpec) {
  const fromExtension = spec.studioExtension?.templateId;
  if (typeof fromExtension === "string" && fromExtension.length > 0) {
    return fromExtension;
  }
  return spec.metadata.labels?.templateId ?? spec.metadata.id;
}

function getDepartmentKey(value: string): DepartmentKey {
  return getDepartmentTemplate(value as DepartmentKey) ? (value as DepartmentKey) : "custom";
}

function toRegistryPath(sourcePath: string, projectRoot: string) {
  const relativePath = path.relative(projectRoot, sourcePath);
  return relativePath.startsWith("..") ? sourcePath : relativePath;
}

function resolveRegisteredPath(sourcePath: string, projectRoot: string) {
  return path.isAbsolute(sourcePath) ? sourcePath : path.resolve(projectRoot, sourcePath);
}

function uniqueLoopId(name: string) {
  const suffix = Date.now().toString(36);
  return `${slug(name)}-${suffix}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
