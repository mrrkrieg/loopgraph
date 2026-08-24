import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  appIdSchema,
  appVersionSchema,
  artifactDigestSchema
} from "loopgraph/core";

const projectKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const correlationIdSchema = z.string().regex(
  /^marketplace_release_status_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
);

export const hostedMarketplaceReleaseStatusInputSchema = z.object({
  appId: appIdSchema,
  version: appVersionSchema,
  status: z.enum(["deprecated", "revoked"]),
  reason: z.string().trim().min(3).max(1000)
}).strict();

const releaseStatusReceiptSchema = z.object({
  appId: appIdSchema,
  version: appVersionSchema,
  artifactDigest: artifactDigestSchema,
  previousStatus: z.enum(["active", "deprecated", "revoked"]),
  releaseStatus: z.enum(["deprecated", "revoked"]),
  changed: z.boolean(),
  correlationId: correlationIdSchema
}).strict();

export type HostedMarketplaceReleaseStatusInput = z.infer<
  typeof hostedMarketplaceReleaseStatusInputSchema
>;
export type HostedMarketplaceReleaseStatusReceipt = z.infer<
  typeof releaseStatusReceiptSchema
>;

export async function setHostedMarketplaceReleaseStatus(input: {
  adminClient: SupabaseClient;
  organizationId: string;
  projectKey: string;
  actorUserId: string;
  release: HostedMarketplaceReleaseStatusInput;
}): Promise<HostedMarketplaceReleaseStatusReceipt> {
  const organizationId = z.string().uuid().parse(input.organizationId);
  const actorUserId = z.string().uuid().parse(input.actorUserId);
  const projectKey = projectKeySchema.parse(input.projectKey);
  const release = hostedMarketplaceReleaseStatusInputSchema.parse(input.release);
  const { data, error } = await input.adminClient.rpc(
    "admin_set_private_marketplace_release_status",
    {
      p_organization_id: organizationId,
      p_project_key: projectKey,
      p_actor_user_id: actorUserId,
      p_app_id: release.appId,
      p_version: release.version,
      p_release_status: release.status,
      p_reason: release.reason
    }
  );
  if (error) throw new Error(`Failed to change hosted marketplace release status: ${error.message}`);
  return releaseStatusReceiptSchema.parse(data);
}

export function hostedMarketplaceProjectKey() {
  return projectKeySchema.parse(process.env.LOOPGRAPH_HOSTED_PROJECT_KEY?.trim() || "default");
}
