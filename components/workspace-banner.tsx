import { createSupabaseAdminClient } from "@/lib/db/supabase";
import { getRegisteredLoopSpecs } from "@/lib/loop-engineering-builder/local-workspace";
import { getWorkspaceMode, workspaceModeBanner } from "@/lib/loop-engineering-builder/workspace-mode";

export async function WorkspaceBanner({ previewMode = false }: { previewMode?: boolean } = {}) {
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  let hasPersistedLoops = false;

  if (supabaseConfigured) {
    const supabase = createSupabaseAdminClient();
    if (supabase) {
      const { count } = await supabase.from("loops").select("*", { count: "exact", head: true });
      hasPersistedLoops = (count ?? 0) > 0;
    }
  }

  const registered = await getRegisteredLoopSpecs();
  const mode = getWorkspaceMode({
    previewMode,
    supabaseConfigured,
    hasPersistedLoops,
    hasLocalRegistry: registered.length > 0
  });
  const banner = workspaceModeBanner(mode);

  return (
    <div className={`mb-4 shrink-0 rounded-md border px-4 py-2 text-sm ${banner.className}`}>
      {banner.label}
    </div>
  );
}
