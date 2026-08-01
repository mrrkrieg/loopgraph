import Link from "next/link";

export function EmptyOperatingState({
  title,
  description,
  command,
  actionHref = "/discovery",
  actionLabel = "Start with Hermes"
}: {
  title: string;
  description: string;
  command?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-paper p-6 text-center">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-ink/60">{description}</p>
      {command ? (
        <code className="mt-4 inline-block rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/75">
          {command}
        </code>
      ) : null}
      <div className="mt-5">
        <Link className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href={actionHref}>
          {actionLabel}
        </Link>
      </div>
    </div>
  );
}
