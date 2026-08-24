import type { AppOnboardingProgressView } from "@/lib/app-platform/install-wizard";

export function AppOnboardingProgress({ journey, compact = false }: { journey: AppOnboardingProgressView; compact?: boolean }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5" aria-label="App onboarding progress">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Hermes-guided setup</div>
          <h2 className={`${compact ? "mt-1 text-base" : "mt-2 text-lg"} font-semibold`}>{journey.headline}</h2>
        </div>
        <div className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink/60">
          {journey.progress.completed}/{journey.progress.total} complete
        </div>
      </div>
      <ol className={`mt-4 grid gap-2 ${compact ? "sm:grid-cols-4 xl:grid-cols-8" : "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"}`}>
        {journey.steps.map((step, index) => (
          <li
            className={`rounded-lg border p-3 ${
              step.status === "complete"
                ? "border-emerald-200 bg-emerald-50"
                : step.status === "current"
                  ? "border-signal bg-orange-50"
                  : step.status === "blocked"
                    ? "border-red-200 bg-red-50"
                    : "border-line bg-surface/50"
            }`}
            key={step.id}
            title={step.summary}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink/40">{index + 1}</span>
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-ink/45">{step.status}</span>
            </div>
            <div className="mt-2 text-xs font-semibold leading-4">{step.label}</div>
          </li>
        ))}
      </ol>
      {!compact ? (
        <div className="mt-4 rounded-md bg-paper px-4 py-3 text-sm leading-6 text-ink/65">
          <strong className="text-ink">Next:</strong> {journey.nextAction.summary}
          {journey.nextAction.requiresHumanConfirmation ? " Hermes must stop for your confirmation at this boundary." : ""}
        </div>
      ) : null}
    </section>
  );
}
