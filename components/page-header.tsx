import React from "react";

export function PageHeader({
  title,
  eyebrow,
  description,
  action
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? (
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
