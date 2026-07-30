import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getWorkspace } from "@/lib/loop-engineering-builder/workspace";
import { isHostedAuthRequired } from "@/lib/auth/hosted-config";
import { saveOrganizationAction, saveProfileAction } from "./actions";
import { signOutAction } from "./sign-out-action";

export default async function SettingsPage() {
  const workspace = await getWorkspace();
  const hosted = isHostedAuthRequired();

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Organization and profile setup for the loop-building workspace."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Organization">
          <form action={saveOrganizationAction}>
            <label className="block text-sm font-medium">
              Organization name
              <input name="organization_name" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.organization.name} />
            </label>
            <button className="mt-4 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Save organization
            </button>
          </form>
        </SectionCard>
        <SectionCard title="Profile">
          <form action={saveProfileAction} className="grid gap-4">
            <label className="block text-sm font-medium">
              Email
              <input
                name="email"
                readOnly
                className="mt-1 w-full rounded-md border border-line bg-slate-50 px-3 py-2 text-muted"
                defaultValue={workspace.profile.email}
              />
            </label>
            <label className="block text-sm font-medium">
              Full name
              <input name="full_name" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.profile.fullName} />
            </label>
            <label className="block text-sm font-medium">
              Role
              <input
                readOnly
                className="mt-1 w-full rounded-md border border-line bg-slate-50 px-3 py-2 text-muted"
                value={workspace.profile.role}
              />
            </label>
            <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Save profile
            </button>
          </form>
        </SectionCard>
      </div>
      {hosted ? (
        <form action={signOutAction} className="mt-5">
          <button className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold" type="submit">
            Sign out
          </button>
        </form>
      ) : null}
    </>
  );
}
