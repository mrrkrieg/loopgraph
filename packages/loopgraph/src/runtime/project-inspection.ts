import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  PROJECT_INSPECTION_SCHEMA_VERSION,
  PROJECT_PROFILE_SCHEMA_VERSION,
  contentHash,
  projectInspectionReportSchema,
  projectProfileSchema,
  type ProjectDependency,
  type ProjectInspectionEvidence,
  type ProjectInspectionReport,
  type ProjectManifestKind,
  type ProjectManifestSummary,
  type ProjectPackageJsonSummary,
  type ProjectProfile,
  type ProjectStackSummary
} from "../core";

const MAX_MANIFEST_BYTES = 256_000;

const manifestCandidates: Array<{ path: string; kind: ProjectManifestKind }> = [
  { path: "package.json", kind: "package_json" },
  { path: "package-lock.json", kind: "lockfile" },
  { path: "pnpm-lock.yaml", kind: "lockfile" },
  { path: "yarn.lock", kind: "lockfile" },
  { path: "bun.lockb", kind: "lockfile" },
  { path: "tsconfig.json", kind: "typescript_config" },
  { path: "next.config.js", kind: "framework_config" },
  { path: "next.config.mjs", kind: "framework_config" },
  { path: "next.config.ts", kind: "framework_config" },
  { path: "vite.config.js", kind: "framework_config" },
  { path: "vite.config.ts", kind: "framework_config" },
  { path: "astro.config.mjs", kind: "framework_config" },
  { path: "svelte.config.js", kind: "framework_config" },
  { path: "tailwind.config.js", kind: "framework_config" },
  { path: "tailwind.config.ts", kind: "framework_config" },
  { path: "pyproject.toml", kind: "python_project" },
  { path: "requirements.txt", kind: "python_requirements" },
  { path: "go.mod", kind: "go_module" },
  { path: "Cargo.toml", kind: "rust_manifest" },
  { path: "Gemfile", kind: "ruby_gemfile" },
  { path: "composer.json", kind: "php_composer" },
  { path: "Dockerfile", kind: "docker" },
  { path: "docker-compose.yml", kind: "docker" },
  { path: "docker-compose.yaml", kind: "docker" },
  { path: "prisma/schema.prisma", kind: "database_schema" },
  { path: "supabase/config.toml", kind: "database_schema" },
  { path: ".env.example", kind: "env_example" },
  { path: ".env.sample", kind: "env_example" },
  { path: ".env.template", kind: "env_example" },
  { path: ".env.local.example", kind: "env_example" }
];

const ignoredEnvFiles = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test"
];

const directoryMarkers: Array<{ path: string; detail: string }> = [
  { path: "app", detail: "App directory" },
  { path: "pages", detail: "Pages directory" },
  { path: "src", detail: "Source directory" },
  { path: "supabase", detail: "Supabase local project directory" },
  { path: "prisma", detail: "Prisma schema directory" }
];

export type InspectProjectInput = {
  projectRoot?: string;
};

export async function inspectProjectManifests(input: InspectProjectInput = {}): Promise<ProjectInspectionReport> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const projectRootRealPath = await safeRealPath(projectRoot);
  const manifests: ProjectManifestSummary[] = [];
  const evidence: ProjectInspectionEvidence[] = [];
  const warnings: string[] = [];
  const ignoredPaths: string[] = [];
  const stack = emptyStack();
  let packageJson: ProjectPackageJsonSummary | undefined;
  const envExampleFiles: string[] = [];
  const envKeys = new Set<string>();

  for (const envFile of ignoredEnvFiles) {
    if (await pathExists(path.join(projectRoot, envFile))) {
      ignoredPaths.push(envFile);
    }
  }

  for (const candidate of manifestCandidates) {
    const resolution = await resolveProjectChild(projectRoot, projectRootRealPath, candidate.path, "file", warnings);
    if (!resolution.exists) continue;
    const summary: ProjectManifestSummary = {
      path: candidate.path,
      kind: candidate.kind,
      readable: true,
      notes: []
    };
    manifests.push(summary);
    if (resolution.blockedReason) {
      summary.readable = false;
      summary.notes.push(resolution.blockedReason);
      continue;
    }
    const absolutePath = resolution.absolutePath;

    const size = await fileSize(absolutePath);
    if (size > MAX_MANIFEST_BYTES) {
      summary.readable = false;
      summary.notes.push(`Skipped because file exceeds ${MAX_MANIFEST_BYTES} bytes.`);
      warnings.push(`Skipped large manifest: ${candidate.path}`);
      continue;
    }

    if (candidate.kind === "package_json") {
      packageJson = await inspectPackageJson(absolutePath, summary, warnings);
      if (packageJson) {
        inferStackFromPackageJson(packageJson, stack, evidence, candidate.path);
      }
      continue;
    }

    if (candidate.kind === "env_example") {
      envExampleFiles.push(candidate.path);
      for (const key of extractEnvKeys(await safeReadText(absolutePath, warnings, candidate.path))) {
        envKeys.add(key);
      }
      evidence.push({ kind: "env_example", path: candidate.path, detail: "Environment example keys were read without values." });
      continue;
    }

    inferStackFromManifest(candidate, stack, evidence);
  }

  await inspectCiWorkflows(projectRoot, projectRootRealPath, manifests, evidence, warnings);
  await inspectDirectoryMarkers(projectRoot, projectRootRealPath, manifests, evidence, stack);

  return projectInspectionReportSchema.parse({
    schemaVersion: PROJECT_INSPECTION_SCHEMA_VERSION,
    projectRootId: `project_${contentHash(projectRoot)}`,
    policy: {
      secretsRead: false,
      allowlistedManifestOnly: true,
      ignoredPaths,
      maxFileBytes: MAX_MANIFEST_BYTES
    },
    manifests,
    stack: sortStack(stack),
    packageJson,
    env: {
      exampleFiles: envExampleFiles.sort(),
      keys: Array.from(envKeys).sort(),
      ignoredEnvFiles: ignoredPaths
    },
    evidence,
    warnings
  });
}

export function buildProjectProfileFromInspection(
  report: ProjectInspectionReport,
  options: {
    displayName?: string;
    confirmedByUser?: boolean;
    confirmedAt?: string;
  } = {}
): ProjectProfile {
  return projectProfileSchema.parse({
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    projectRootId: report.projectRootId,
    displayName: options.displayName ?? report.packageJson?.name ?? "Local project",
    repoType: inferRepoType(report),
    languages: report.stack.languages,
    frameworks: report.stack.frameworks,
    packageManagers: report.stack.packageManagers,
    datastores: report.stack.databases,
    deploymentTargets: inferDeploymentTargets(report),
    detectedIntegrationHints: uniqueStrings([
      ...report.stack.databases,
      ...report.stack.analytics,
      ...report.stack.cms,
      ...report.stack.auth,
      ...report.stack.queues,
      ...report.stack.ai,
      ...report.stack.tooling
    ]),
    manifestEvidence: report.evidence.map((item) => ({
      path: item.path,
      detector: item.kind,
      confidence: evidenceConfidence(item.kind)
    })),
    confirmedByUser: options.confirmedByUser ?? false,
    confirmedAt: options.confirmedAt,
    inspectionVersion: PROJECT_INSPECTION_SCHEMA_VERSION
  });
}

async function inspectPackageJson(
  filePath: string,
  summary: ProjectManifestSummary,
  warnings: string[]
): Promise<ProjectPackageJsonSummary | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    const packageJson = {
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed.private === "boolean" ? { private: parsed.private } : {}),
      ...(typeof parsed.packageManager === "string" ? { packageManager: parsed.packageManager } : {}),
      scripts: Object.keys(isRecord(parsed.scripts) ? parsed.scripts : {}).sort(),
      dependencies: [
        ...dependenciesFromGroup(parsed.dependencies, "dependencies"),
        ...dependenciesFromGroup(parsed.devDependencies, "devDependencies"),
        ...dependenciesFromGroup(parsed.peerDependencies, "peerDependencies"),
        ...dependenciesFromGroup(parsed.optionalDependencies, "optionalDependencies")
      ].sort((left, right) => `${left.group}:${left.name}`.localeCompare(`${right.group}:${right.name}`))
    } satisfies ProjectPackageJsonSummary;
    summary.notes.push(`Read ${packageJson.dependencies.length} dependency names and ${packageJson.scripts.length} script names.`);
    return packageJson;
  } catch (error) {
    summary.readable = false;
    summary.notes.push("Could not parse package.json.");
    warnings.push(`Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function dependenciesFromGroup(value: unknown, group: ProjectDependency["group"]): ProjectDependency[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([name, version]) => ({
    name,
    ...(typeof version === "string" ? { versionRange: version } : {}),
    group
  }));
}

function inferStackFromPackageJson(
  packageJson: ProjectPackageJsonSummary,
  stack: MutableStack,
  evidence: ProjectInspectionEvidence[],
  manifestPath: string
): void {
  add(stack.languages, "JavaScript/TypeScript");
  if (packageJson.packageManager?.startsWith("pnpm")) add(stack.packageManagers, "pnpm");
  if (packageJson.packageManager?.startsWith("yarn")) add(stack.packageManagers, "Yarn");
  if (packageJson.packageManager?.startsWith("npm")) add(stack.packageManagers, "npm");
  if (packageJson.packageManager?.startsWith("bun")) add(stack.packageManagers, "Bun");

  const deps = new Set(packageJson.dependencies.map((dependency) => dependency.name));
  const detect = (name: string, bucket: keyof MutableStack, label: string) => {
    if (deps.has(name)) {
      add(stack[bucket], label);
      evidence.push({ kind: "package_json", path: manifestPath, detail: `Detected ${label} from dependency ${name}.` });
    }
  };

  detect("next", "frameworks", "Next.js");
  detect("react", "frameworks", "React");
  detect("vue", "frameworks", "Vue");
  detect("svelte", "frameworks", "Svelte");
  detect("astro", "frameworks", "Astro");
  detect("express", "frameworks", "Express");
  detect("@supabase" + "/supabase-js", "databases", "Supabase");
  detect("firebase", "databases", "Firebase");
  detect("@prisma/client", "databases", "Prisma");
  detect("prisma", "databases", "Prisma");
  detect("drizzle-orm", "databases", "Drizzle ORM");
  detect("pg", "databases", "Postgres");
  detect("mysql2", "databases", "MySQL");
  detect("@vercel/analytics", "analytics", "Vercel Analytics");
  detect("posthog-js", "analytics", "PostHog");
  detect("stripe", "tooling", "Stripe");
  detect("next-auth", "auth", "Auth.js/NextAuth");
  detect("@clerk/nextjs", "auth", "Clerk");
  detect("@auth/core", "auth", "Auth.js");
  detect("@notionhq/client", "cms", "Notion");
  detect("contentful", "cms", "Contentful");
  detect("sanity", "cms", "Sanity");
  detect("openai", "ai", "OpenAI SDK");
  detect("ai", "ai", "Vercel AI SDK");
  detect("bullmq", "queues", "BullMQ");
  detect("inngest", "queues", "Inngest");
  detect("vitest", "testing", "Vitest");
  detect("jest", "testing", "Jest");
  detect("playwright", "testing", "Playwright");
}

function inferRepoType(report: ProjectInspectionReport): ProjectProfile["repoType"] {
  const frameworkSet = new Set(report.stack.frameworks);
  if (frameworkSet.has("Next.js") || frameworkSet.has("React") || frameworkSet.has("Vue") || frameworkSet.has("Svelte") || frameworkSet.has("Astro")) {
    return "application";
  }
  if (frameworkSet.has("Express") || report.stack.databases.length > 0 || report.stack.queues.length > 0) {
    return "service";
  }
  if (report.packageJson?.packageManager && report.manifests.some((manifest) => manifest.kind === "lockfile")) {
    return "application";
  }
  if (report.manifests.length > 0 && report.stack.languages.length === 0) return "non_code_workspace";
  return "unknown";
}

function inferDeploymentTargets(report: ProjectInspectionReport): string[] {
  return uniqueStrings([
    ...report.stack.hosting,
    ...(report.manifests.some((manifest) => manifest.kind === "docker") ? ["Docker"] : [])
  ]);
}

function evidenceConfidence(kind: ProjectManifestKind): number {
  if (kind === "package_json") return 0.9;
  if (kind === "framework_config" || kind === "database_schema" || kind === "typescript_config") return 0.8;
  if (kind === "lockfile" || kind === "directory_marker" || kind === "env_example") return 0.6;
  return 0.7;
}

function inferStackFromManifest(
  candidate: { path: string; kind: ProjectManifestKind },
  stack: MutableStack,
  evidence: ProjectInspectionEvidence[]
): void {
  const detail = `Detected ${candidate.path}.`;
  evidence.push({ kind: candidate.kind, path: candidate.path, detail });

  if (candidate.path === "package-lock.json") add(stack.packageManagers, "npm");
  if (candidate.path === "pnpm-lock.yaml") add(stack.packageManagers, "pnpm");
  if (candidate.path === "yarn.lock") add(stack.packageManagers, "Yarn");
  if (candidate.path === "bun.lockb") add(stack.packageManagers, "Bun");
  if (candidate.kind === "typescript_config") add(stack.languages, "TypeScript");
  if (candidate.path.startsWith("next.config")) add(stack.frameworks, "Next.js");
  if (candidate.path.startsWith("vite.config")) add(stack.tooling, "Vite");
  if (candidate.path.startsWith("astro.config")) add(stack.frameworks, "Astro");
  if (candidate.path.startsWith("svelte.config")) add(stack.frameworks, "Svelte");
  if (candidate.path.startsWith("tailwind.config")) add(stack.tooling, "Tailwind CSS");
  if (candidate.kind === "python_project" || candidate.kind === "python_requirements") add(stack.languages, "Python");
  if (candidate.kind === "go_module") add(stack.languages, "Go");
  if (candidate.kind === "rust_manifest") add(stack.languages, "Rust");
  if (candidate.kind === "ruby_gemfile") add(stack.languages, "Ruby");
  if (candidate.kind === "php_composer") add(stack.languages, "PHP");
  if (candidate.kind === "docker") add(stack.hosting, "Docker");
  if (candidate.path.startsWith("prisma/")) add(stack.databases, "Prisma");
  if (candidate.path.startsWith("supabase/")) add(stack.databases, "Supabase");
}

async function inspectCiWorkflows(
  projectRoot: string,
  projectRootRealPath: string,
  manifests: ProjectManifestSummary[],
  evidence: ProjectInspectionEvidence[],
  warnings: string[]
): Promise<void> {
  const workflowsResolution = await resolveProjectChild(projectRoot, projectRootRealPath, path.join(".github", "workflows"), "directory", warnings);
  if (!workflowsResolution.exists || workflowsResolution.blockedReason) return;
  try {
    const entries = (await readdir(workflowsResolution.absolutePath))
      .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
      .sort();
    for (const entry of entries) {
      const relativePath = path.join(".github", "workflows", entry);
      manifests.push({
        path: relativePath,
        kind: "ci_workflow",
        readable: false,
        notes: ["Workflow filename detected; contents were not read."]
      });
      evidence.push({ kind: "ci_workflow", path: relativePath, detail: "CI workflow filename detected without reading contents." });
    }
  } catch (error) {
    warnings.push(`Could not list CI workflows: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function inspectDirectoryMarkers(
  projectRoot: string,
  projectRootRealPath: string,
  manifests: ProjectManifestSummary[],
  evidence: ProjectInspectionEvidence[],
  stack: MutableStack
): Promise<void> {
  for (const marker of directoryMarkers) {
    const resolution = await resolveProjectChild(projectRoot, projectRootRealPath, marker.path, "directory");
    if (!resolution.exists || resolution.blockedReason) continue;
    manifests.push({
      path: marker.path,
      kind: "directory_marker",
      readable: false,
      notes: ["Directory existence detected; contents were not read."]
    });
    evidence.push({ kind: "directory_marker", path: marker.path, detail: marker.detail });
    if (marker.path === "app" || marker.path === "pages") add(stack.frameworks, "Next.js");
    if (marker.path === "supabase") add(stack.databases, "Supabase");
    if (marker.path === "prisma") add(stack.databases, "Prisma");
  }
}

async function safeReadText(filePath: string, warnings: string[], relativePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    warnings.push(`Could not read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

function extractEnvKeys(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((key): key is string => Boolean(key));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

type ProjectChildResolution = {
  absolutePath: string;
  exists: boolean;
  blockedReason?: string;
};

async function resolveProjectChild(
  projectRoot: string,
  projectRootRealPath: string,
  relativePath: string,
  expectedKind: "file" | "directory",
  warnings: string[] = []
): Promise<ProjectChildResolution> {
  const absolutePath = path.resolve(projectRoot, relativePath);
  const normalizedProjectRoot = `${path.resolve(projectRoot)}${path.sep}`;
  if (absolutePath !== path.resolve(projectRoot) && !absolutePath.startsWith(normalizedProjectRoot)) {
    const blockedReason = "Skipped because path escapes the selected project root.";
    warnings.push(`Skipped path outside project root: ${relativePath}`);
    return { absolutePath, exists: true, blockedReason };
  }

  let itemStat;
  try {
    itemStat = await lstat(absolutePath);
  } catch {
    return { absolutePath, exists: false };
  }

  const actualKindMatches = expectedKind === "directory"
    ? itemStat.isDirectory() || itemStat.isSymbolicLink()
    : itemStat.isFile() || itemStat.isSymbolicLink();
  if (!actualKindMatches) return { absolutePath, exists: false };

  if (itemStat.isSymbolicLink()) {
    const childRealPath = await safeRealPath(absolutePath);
    if (!isPathInsideRealRoot(childRealPath, projectRootRealPath)) {
      const blockedReason = "Skipped because symlink target escapes the selected project root.";
      warnings.push(`Skipped symlink escape: ${relativePath}`);
      return { absolutePath, exists: true, blockedReason };
    }
  }

  return { absolutePath, exists: true };
}

async function safeRealPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isPathInsideRealRoot(childRealPath: string, projectRootRealPath: string): boolean {
  const normalizedRoot = path.resolve(projectRootRealPath);
  const normalizedChild = path.resolve(childRealPath);
  return normalizedChild === normalizedRoot || normalizedChild.startsWith(`${normalizedRoot}${path.sep}`);
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

type MutableStack = Record<keyof ProjectStackSummary, Set<string>>;

function emptyStack(): MutableStack {
  return {
    languages: new Set(),
    frameworks: new Set(),
    packageManagers: new Set(),
    databases: new Set(),
    hosting: new Set(),
    queues: new Set(),
    auth: new Set(),
    analytics: new Set(),
    cms: new Set(),
    ai: new Set(),
    testing: new Set(),
    tooling: new Set()
  };
}

function sortStack(stack: MutableStack): ProjectStackSummary {
  return Object.fromEntries(
    Object.entries(stack).map(([key, values]) => [key, Array.from(values).sort()])
  ) as ProjectStackSummary;
}

function add(target: Set<string>, value: string): void {
  target.add(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
