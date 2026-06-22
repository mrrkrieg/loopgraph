import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { saveOrganizationAction, saveProfileAction } from "./actions";

export default function SettingsPage() {
  const workspace = getDemoWorkspace();

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
              <input name="email" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.profile.email} />
            </label>
            <label className="block text-sm font-medium">
              Full name
              <input name="full_name" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.profile.fullName} />
            </label>
            <label className="block text-sm font-medium">
              Role
              <select name="role" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.profile.role}>
                <option value="owner">owner</option>
                <option value="admin">admin</option>
                <option value="member">member</option>
              </select>
            </label>
            <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Save profile
            </button>
          </form>
        </SectionCard>
      </div>
    </>
  );
}
