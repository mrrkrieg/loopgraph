import { requireHostedPermission } from "@/lib/auth/hosted-access";
import { DeviceAuthorizationForm } from "./device-authorization-form";

export const dynamic = "force-dynamic";

export default async function DeviceAuthorizationPage({
  searchParams
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const identity = await requireHostedPermission("workspace.read");
  const { user_code: initialCode = "" } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Loopgraph CLI</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Authorize this terminal</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted-foreground)]">
        Signed in as {identity?.email ?? "an organization member"}. Confirm that the code below
        matches the code in your terminal before granting read-only marketplace access.
      </p>
      <div className="mt-8">
        <DeviceAuthorizationForm initialCode={initialCode} />
      </div>
    </main>
  );
}
