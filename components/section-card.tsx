import React from "react";

export function SectionCard({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-ink/60">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
