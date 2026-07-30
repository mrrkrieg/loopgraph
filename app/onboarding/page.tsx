import { redirect } from "next/navigation";
import { getHostedIdentity } from "@/lib/auth/hosted-access";
import { getHostedOrganizationId } from "@/lib/auth/hosted-config";
import { createOrganizationAction } from "./actions";

export default async function OnboardingPage() {
  const identity = await getHostedIdentity();
  if (!identity) redirect("/");
  if (identity.membership) redirect("/");
  const deploymentOrganizationId = getHostedOrganizationId();

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">First workspace</p>
      <h1 className="mt-2 text-3xl font-semibold">Create your organization</h1>
      {deploymentOrganizationId ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950">
          This deployment is already bound to an organization. Ask an owner to invite your signed-in
          account instead of creating a separate workspace.
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-muted">
            This becomes the tenant boundary for your loops, events, evidence, and approvals.
          </p>
          <form action={createOrganizationAction} className="mt-6 grid gap-4 rounded-xl border border-line bg-white p-6">
            <label className="text-sm font-medium">
              Organization name
              <input
                name="organization_name"
                required
                minLength={2}
                maxLength={120}
                className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2"
              />
            </label>
            <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
              Create secure workspace
            </button>
          </form>
        </>
      )}
    </main>
  );
}
