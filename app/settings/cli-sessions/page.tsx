import { PageHeader } from "@/components/page-header";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import { listCliAccessSessions } from "@/lib/auth/cli-session-admin";
import { CliSessionAdmin } from "./cli-session-admin";

export const dynamic = "force-dynamic";

export default async function CliSessionsSettingsPage() {
  const database = await getWorkspaceDatabase("credentials.revoke");
  const initialPage = await listCliAccessSessions(database);
  return (
    <>
      <PageHeader
        eyebrow="Enterprise security"
        title="CLI sessions"
        description="Inspect browser-authorized human CLI sessions and immediately revoke one device, one user, or every organization session. Token material is never displayed or returned by this page."
      />
      <CliSessionAdmin initialPage={initialPage} />
    </>
  );
}
