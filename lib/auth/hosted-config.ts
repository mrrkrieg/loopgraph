export const HOSTED_ORGANIZATION_COOKIE = "loopgraph-organization-id";

export function getHostedOrganizationId(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const value = env.LOOPGRAPH_HOSTED_ORGANIZATION_ID?.trim();
  return value || undefined;
}

export function isPublicHostedPreviewEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LOOPGRAPH_HOSTED_MODE === "1") return false;
  const productionUrl = env.VERCEL_PROJECT_PRODUCTION_URL
    ?.replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return productionUrl === "loopgraph.vercel.app" || env.LOOPGRAPH_PREVIEW_CONTENT === "1";
}

export function isHostedAuthRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isPublicHostedPreviewEnvironment(env)) return false;
  const supabaseConfigured = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
  return supabaseConfigured && (
    env.LOOPGRAPH_HOSTED_MODE === "1" ||
    env.VERCEL_ENV === "production"
  );
}
