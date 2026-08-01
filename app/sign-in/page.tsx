import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next;
  const nextPath = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg items-center px-6">
      <section className="w-full rounded-xl border border-line bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Hosted workspace</p>
        <h1 className="mt-2 text-3xl font-semibold">Sign in to Loopgraph</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          We use a passwordless link. Your session is scoped to the organizations where you have an
          active membership.
        </p>
        <SignInForm nextPath={nextPath} />
      </section>
    </main>
  );
}
