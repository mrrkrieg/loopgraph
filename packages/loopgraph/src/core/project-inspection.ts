import { z } from "zod";

export const PROJECT_INSPECTION_SCHEMA_VERSION = "project-inspection/v1alpha1" as const;
export const PROJECT_PROFILE_SCHEMA_VERSION = "project-profile/v1alpha1" as const;

export const projectManifestKindSchema = z.enum([
  "package_json",
  "lockfile",
  "typescript_config",
  "framework_config",
  "python_project",
  "python_requirements",
  "go_module",
  "rust_manifest",
  "ruby_gemfile",
  "php_composer",
  "docker",
  "database_schema",
  "ci_workflow",
  "env_example",
  "directory_marker"
]);

export const projectDependencySchema = z.object({
  name: z.string(),
  versionRange: z.string().optional(),
  group: z.enum(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
});

export const projectManifestSummarySchema = z.object({
  path: z.string(),
  kind: projectManifestKindSchema,
  readable: z.boolean(),
  notes: z.array(z.string()).default([])
});

export const projectStackSummarySchema = z.object({
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  packageManagers: z.array(z.string()).default([]),
  databases: z.array(z.string()).default([]),
  hosting: z.array(z.string()).default([]),
  queues: z.array(z.string()).default([]),
  auth: z.array(z.string()).default([]),
  analytics: z.array(z.string()).default([]),
  cms: z.array(z.string()).default([]),
  ai: z.array(z.string()).default([]),
  testing: z.array(z.string()).default([]),
  tooling: z.array(z.string()).default([])
});

export const projectPackageJsonSummarySchema = z.object({
  name: z.string().optional(),
  private: z.boolean().optional(),
  packageManager: z.string().optional(),
  scripts: z.array(z.string()).default([]),
  dependencies: z.array(projectDependencySchema).default([])
});

export const projectEnvSummarySchema = z.object({
  exampleFiles: z.array(z.string()).default([]),
  keys: z.array(z.string()).default([]),
  ignoredEnvFiles: z.array(z.string()).default([])
});

export const projectInspectionEvidenceSchema = z.object({
  kind: projectManifestKindSchema,
  path: z.string(),
  detail: z.string()
});

export const projectInspectionReportSchema = z.object({
  schemaVersion: z.literal(PROJECT_INSPECTION_SCHEMA_VERSION).default(PROJECT_INSPECTION_SCHEMA_VERSION),
  projectRootId: z.string(),
  policy: z.object({
    secretsRead: z.literal(false),
    allowlistedManifestOnly: z.literal(true),
    ignoredPaths: z.array(z.string()).default([]),
    maxFileBytes: z.number().int().positive()
  }),
  manifests: z.array(projectManifestSummarySchema).default([]),
  stack: projectStackSummarySchema,
  packageJson: projectPackageJsonSummarySchema.optional(),
  env: projectEnvSummarySchema,
  evidence: z.array(projectInspectionEvidenceSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const projectProfileSchema = z.object({
  schemaVersion: z.literal(PROJECT_PROFILE_SCHEMA_VERSION).default(PROJECT_PROFILE_SCHEMA_VERSION),
  projectRootId: z.string(),
  displayName: z.string(),
  repoType: z.enum(["application", "monorepo", "service", "non_code_workspace", "unknown"]).default("unknown"),
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  packageManagers: z.array(z.string()).default([]),
  datastores: z.array(z.string()).default([]),
  deploymentTargets: z.array(z.string()).default([]),
  detectedIntegrationHints: z.array(z.string()).default([]),
  manifestEvidence: z.array(z.object({
    path: z.string(),
    detector: projectManifestKindSchema,
    confidence: z.number().min(0).max(1)
  })).default([]),
  confirmedByUser: z.boolean().default(false),
  confirmedAt: z.string().datetime().optional(),
  inspectionVersion: z.literal(PROJECT_INSPECTION_SCHEMA_VERSION).default(PROJECT_INSPECTION_SCHEMA_VERSION)
});

export type ProjectManifestKind = z.infer<typeof projectManifestKindSchema>;
export type ProjectDependency = z.infer<typeof projectDependencySchema>;
export type ProjectManifestSummary = z.infer<typeof projectManifestSummarySchema>;
export type ProjectStackSummary = z.infer<typeof projectStackSummarySchema>;
export type ProjectPackageJsonSummary = z.infer<typeof projectPackageJsonSummarySchema>;
export type ProjectEnvSummary = z.infer<typeof projectEnvSummarySchema>;
export type ProjectInspectionEvidence = z.infer<typeof projectInspectionEvidenceSchema>;
export type ProjectInspectionReport = z.infer<typeof projectInspectionReportSchema>;
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
