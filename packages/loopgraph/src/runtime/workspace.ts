import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  contentHash,
  DEPARTMENT_TYPES,
  normalizeDepartmentType,
  type DepartmentType
} from "../core";
import { loadLoopSpecFromPath } from "./loader";
import { getLoopgraphRoot } from "./storage-resolver";

export const LOOPGRAPH_WORKSPACE_SCHEMA_VERSION = "workspace/v1alpha1" as const;

const workspaceDirectoryNames = [
  "discovery",
  "generated",
  "traces",
  "reviews",
  "cases",
  "connections",
  "routing"
] as const;

const rawRegisteredLoopSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  templateId: z.string().min(1).optional(),
  department: z.string().default("custom"),
  addedAt: z.string().optional()
});

const rawWorkspaceRegistrySchema = z.object({
  version: z.literal(1).optional(),
  schemaVersion: z.string().optional(),
  projectRoot: z.string().optional(),
  projectRootId: z.string().optional(),
  displayName: z.string().optional(),
  demoCatalogEnabled: z.boolean().optional(),
  registeredSpecs: z.array(z.unknown()).optional(),
  initializedAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export type RegisteredLoopSpec = {
  id: string;
  name: string;
  path: string;
  templateId?: string;
  department: DepartmentType;
  addedAt: string;
};

export type LoopgraphWorkspaceRegistry = {
  version: 1;
  schemaVersion: typeof LOOPGRAPH_WORKSPACE_SCHEMA_VERSION;
  projectRoot: string;
  projectRootId: string;
  displayName: string;
  demoCatalogEnabled: boolean;
  registeredSpecs: RegisteredLoopSpec[];
  initializedAt: string;
  updatedAt: string;
};

export type WorkspaceInitOptions = {
  projectRoot?: string;
  displayName?: string;
  demoCatalogEnabled?: boolean;
  createdBy?: "cli" | "hermes" | "browser" | "api";
  now?: Date;
};

export type WorkspaceInspectOptions = {
  projectRoot?: string;
  createIfMissing?: boolean;
};

export type WorkspaceInspectResult = {
  exists: boolean;
  projectRoot: string;
  workspaceRoot: string;
  registryPath: string;
  registry: LoopgraphWorkspaceRegistry;
  directories: Array<{ name: (typeof workspaceDirectoryNames)[number]; path: string; exists: boolean }>;
  registeredSpecCount: number;
  registeredDepartments: DepartmentType[];
  routingReadySpecCount: number;
};

export function getWorkspaceRegistryPath(projectRoot = process.cwd()): string {
  return path.join(getLoopgraphRoot(projectRoot), "workspace.json");
}

export async function initLoopgraphWorkspace(options: WorkspaceInitOptions = {}): Promise<LoopgraphWorkspaceRegistry> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const nowIso = (options.now ?? new Date()).toISOString();
  const existedBeforeInit = await pathExists(getWorkspaceRegistryPath(projectRoot));
  const existing = await readLoopgraphWorkspace(projectRoot);

  await mkdir(loopgraphRoot, { recursive: true });
  await Promise.all(workspaceDirectoryNames.map((name) => mkdir(path.join(loopgraphRoot, name), { recursive: true })));

  const registry: LoopgraphWorkspaceRegistry = {
    version: 1,
    schemaVersion: LOOPGRAPH_WORKSPACE_SCHEMA_VERSION,
    projectRoot,
    projectRootId: workspaceProjectRootId(projectRoot),
    displayName: options.displayName ?? existing.displayName,
    demoCatalogEnabled: options.demoCatalogEnabled ?? existing.demoCatalogEnabled,
    registeredSpecs: existing.registeredSpecs,
    initializedAt: existedBeforeInit ? existing.initializedAt : nowIso,
    updatedAt: nowIso
  };

  await writeLoopgraphWorkspace(registry, projectRoot);
  return registry;
}

export async function inspectLoopgraphWorkspace(options: WorkspaceInspectOptions = {}): Promise<WorkspaceInspectResult> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const registryPath = getWorkspaceRegistryPath(projectRoot);
  const existedBeforeInspect = await pathExists(registryPath);
  const registry = options.createIfMissing
    ? await initLoopgraphWorkspace({ projectRoot })
    : await readLoopgraphWorkspace(projectRoot);
  const loopgraphRoot = getLoopgraphRoot(projectRoot);
  const directories = await Promise.all(workspaceDirectoryNames.map(async (name) => {
    const directoryPath = path.join(loopgraphRoot, name);
    return {
      name,
      path: directoryPath,
      exists: await pathExists(directoryPath)
    };
  }));
  const registeredDepartments = Array.from(new Set(registry.registeredSpecs.map((spec) => spec.department)))
    .sort((left, right) => DEPARTMENT_TYPES.indexOf(left) - DEPARTMENT_TYPES.indexOf(right));
  const routingReadySpecCount = await countRoutingReadySpecs(registry, projectRoot);

  return {
    exists: existedBeforeInspect || await pathExists(registryPath),
    projectRoot,
    workspaceRoot: loopgraphRoot,
    registryPath,
    registry,
    directories,
    registeredSpecCount: registry.registeredSpecs.length,
    registeredDepartments,
    routingReadySpecCount
  };
}

export async function readLoopgraphWorkspace(projectRoot = process.cwd()): Promise<LoopgraphWorkspaceRegistry> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const registryPath = getWorkspaceRegistryPath(resolvedProjectRoot);
  const nowIso = new Date(0).toISOString();

  try {
    const raw = await readFile(registryPath, "utf8");
    const parsed = rawWorkspaceRegistrySchema.parse(JSON.parse(raw));
    return {
      version: 1,
      schemaVersion: LOOPGRAPH_WORKSPACE_SCHEMA_VERSION,
      projectRoot: path.resolve(parsed.projectRoot ?? resolvedProjectRoot),
      projectRootId: parsed.projectRootId ?? workspaceProjectRootId(resolvedProjectRoot),
      displayName: parsed.displayName ?? path.basename(resolvedProjectRoot),
      demoCatalogEnabled: parsed.demoCatalogEnabled ?? false,
      registeredSpecs: (parsed.registeredSpecs ?? []).flatMap(parseRegisteredLoopSpec),
      initializedAt: parsed.initializedAt ?? nowIso,
      updatedAt: parsed.updatedAt ?? parsed.initializedAt ?? nowIso
    };
  } catch {
    return defaultWorkspaceRegistry(resolvedProjectRoot);
  }
}

export async function writeLoopgraphWorkspace(
  registry: LoopgraphWorkspaceRegistry,
  projectRoot = registry.projectRoot
): Promise<void> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const parsed = {
    ...registry,
    version: 1 as const,
    schemaVersion: LOOPGRAPH_WORKSPACE_SCHEMA_VERSION,
    projectRoot: resolvedProjectRoot,
    projectRootId: workspaceProjectRootId(resolvedProjectRoot),
    registeredSpecs: registry.registeredSpecs.map((entry) => ({
      ...entry,
      department: normalizeDepartmentType(entry.department) ?? "custom"
    }))
  };

  const registryPath = getWorkspaceRegistryPath(resolvedProjectRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

export function workspaceProjectRootId(projectRoot: string): string {
  return `project_${contentHash(path.resolve(projectRoot))}`;
}

function defaultWorkspaceRegistry(projectRoot: string): LoopgraphWorkspaceRegistry {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const nowIso = new Date(0).toISOString();
  return {
    version: 1,
    schemaVersion: LOOPGRAPH_WORKSPACE_SCHEMA_VERSION,
    projectRoot: resolvedProjectRoot,
    projectRootId: workspaceProjectRootId(resolvedProjectRoot),
    displayName: path.basename(resolvedProjectRoot),
    demoCatalogEnabled: false,
    registeredSpecs: [],
    initializedAt: nowIso,
    updatedAt: nowIso
  };
}

function parseRegisteredLoopSpec(input: unknown): RegisteredLoopSpec[] {
  const parsed = rawRegisteredLoopSpecSchema.safeParse(input);
  if (!parsed.success) return [];
  return [{
    id: parsed.data.id,
    name: parsed.data.name,
    path: parsed.data.path,
    ...(parsed.data.templateId ? { templateId: parsed.data.templateId } : {}),
    department: normalizeDepartmentType(parsed.data.department) ?? "custom",
    addedAt: parsed.data.addedAt ?? new Date(0).toISOString()
  }];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function countRoutingReadySpecs(
  registry: LoopgraphWorkspaceRegistry,
  projectRoot: string
): Promise<number> {
  let count = 0;
  for (const spec of registry.registeredSpecs) {
    const specPath = path.isAbsolute(spec.path) ? spec.path : path.resolve(projectRoot, spec.path);
    const loaded = await loadLoopSpecFromPath(specPath);
    if (loaded.ok && loaded.spec.routing) count += 1;
  }
  return count;
}
