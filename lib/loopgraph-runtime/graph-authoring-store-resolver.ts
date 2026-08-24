import "server-only";

import type { HostedPermission } from "@/lib/auth/hosted-access";
import {
  isHostedAuthRequired,
  isPublicHostedPreviewEnvironment
} from "@/lib/auth/hosted-config";
import { SupabaseGraphAuthoringStore } from "@/lib/db/adapters/supabase-graph-authoring-store";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  FileGraphAuthoringStore,
  getLoopgraphRoot,
  type GraphAuthoringStore
} from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "./storage-resolver";

export async function getGraphAuthoringContext(
  permission: HostedPermission
): Promise<{
  store: GraphAuthoringStore;
  workspaceId: string;
  companyId: string;
  actorId: string;
}> {
  if (isPublicHostedPreviewEnvironment() && permission !== "workspace.read") {
    throw new Error("The public Loopgraph preview is read-only");
  }
  if (!isHostedAuthRequired()) {
    return {
      store: new FileGraphAuthoringStore(
        getLoopgraphRoot(getActiveLoopgraphProjectRoot())
      ),
      workspaceId: "local",
      companyId: "local",
      actorId: "loopgraph-ui"
    };
  }

  const database = await getWorkspaceDatabase(permission);
  if (
    !database.client ||
    !database.organizationId ||
    !database.userId
  ) {
    throw new Error("The authenticated graph-authoring workspace is unavailable");
  }
  const projectKey = getHostedProjectKey();
  return {
    store: new SupabaseGraphAuthoringStore(database.client, {
      organizationId: database.organizationId,
      projectKey,
      actorId: database.userId
    }),
    workspaceId: projectKey,
    companyId: database.organizationId,
    actorId: database.userId
  };
}

export function getHostedProjectKey() {
  const projectKey =
    process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(projectKey)) {
    throw new Error("LOOPGRAPH_HOSTED_PROJECT_KEY is invalid");
  }
  return projectKey;
}
