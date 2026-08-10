"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AppInstallPlan } from "loopgraph/core";
import {
  displayConfigurationValue,
  installPlanBlockersForView,
  type InstallWizardApp,
  type InstallWizardQuestion,
  type InstallWizardState
} from "@/lib/app-platform/install-wizard";
import {
  applyReviewedAppInstallAction,
  planMarketplaceAppInstallAction
} from "@/app/marketplace/[appId]/install/actions";

export function InstallWizard({ app, initialPlan }: { app: InstallWizardApp; initialPlan: AppInstallPlan }) {
  const initialState: InstallWizardState = { stage: "configure", plan: initialPlan };
  const [state, planAction, isPlanning] = useActionState(planMarketplaceAppInstallAction, initialState);
  const blockers = installPlanBlockersForView(state.plan);
  const ready = blockers.length === 0;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Step 1 · stack and modules</div>
            <h2 className="mt-2 text-xl font-semibold">Confirm what will be installed</h2>
            <p className="mt-2 text-sm leading-6 text-ink/60">{app.preset.name}. Provider credentials remain in the Connector Broker or your enterprise vault.</p>
          </div>
          <Link className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:border-ink" href={`/marketplace/${encodeURIComponent(app.id)}`}>Change stack</Link>
        </div>

        <form action={planAction} className="mt-6" key={state.plan.planDigest}>
          <input name="appId" type="hidden" value={app.id} />
          <input name="presetId" type="hidden" value={app.preset.id} />
          {app.modules.length > 0 ? (
            <fieldset>
              <legend className="text-sm font-semibold">Included modules</legend>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {app.modules.map((module) => (
                  <label className="flex gap-3 rounded-lg border border-line p-4" key={module.id}>
                    <input defaultChecked={state.plan.selectedModules.includes(module.id)} name="selectedModule" type="checkbox" value={module.id} />
                    <span><span className="block text-sm font-semibold">{module.name}</span><span className="mt-1 block text-xs leading-5 text-ink/55">{module.description}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="mt-7 border-t border-line pt-6">
            <legend className="text-sm font-semibold">Step 2 · company-specific answers</legend>
            <p className="mt-2 text-sm leading-6 text-ink/55">Preset and approved company-context values are filled in first. Confirm or change only what is specific to this installation.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {app.questions.map((question) => (
                <QuestionField key={question.key} plan={state.plan} question={question} />
              ))}
            </div>
          </fieldset>

          {state.error ? <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{state.error}</div> : null}
          <button className="mt-6 rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60" disabled={isPlanning} type="submit">
            {isPlanning ? "Validating answers…" : "Create exact install plan"}
          </button>
        </form>
      </section>

      <section className={`rounded-xl border p-5 sm:p-6 ${ready ? "border-emerald-300 bg-emerald-50" : "border-orange-300 bg-orange-50"}`}>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Step 3 · readiness</div>
        <h2 className="mt-2 text-xl font-semibold">{ready ? "Ready for governed installation" : `${blockers.length} item${blockers.length === 1 ? "" : "s"} still need attention`}</h2>
        {state.notice ? <p className="mt-2 text-sm leading-6 text-ink/65">{state.notice}</p> : null}
        {blockers.length > 0 ? (
          <ul className="mt-4 space-y-2 text-sm text-ink/70">{blockers.map((blocker) => <li className="rounded-md border border-black/10 bg-white/70 px-3 py-2" key={blocker}>{blocker}</li>)}</ul>
        ) : null}
        {state.plan.capabilityResolutions.some((resolution) => resolution.required && !["connected", "reusable"].includes(resolution.status)) ? (
          <Link className="mt-4 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/settings/integrations">Connect required systems</Link>
        ) : null}
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Step 4 · exact transaction review</div>
        <h2 className="mt-2 text-xl font-semibold">Graph, permissions, and tests</h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <ReviewColumn title="Company graph">
            <ReviewMetric label="Nodes added" value={state.plan.graphDiff.nodesAdded.length} />
            <ReviewMetric label="Nodes reused" value={state.plan.graphDiff.nodesReused.length} />
            <ReviewMetric label="Edges added" value={state.plan.graphDiff.edgesAdded.length} />
          </ReviewColumn>
          <ReviewColumn title="Provider authority">
            {state.plan.permissions.map((permission) => <div className="border-b border-line py-2 text-xs last:border-0" key={permission.capability}><div className="font-mono font-semibold">{permission.capability}</div><div className="mt-1 capitalize text-ink/50">{permission.authority} · {permission.decision.replace(/_/g, " ")}</div></div>)}
          </ReviewColumn>
          <ReviewColumn title="Required tests">
            {state.plan.requiredTests.map((test) => <div className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold" key={test}>{test.replace(/_/g, " ")}</div>)}
          </ReviewColumn>
        </div>
        <div className="mt-5 rounded-md bg-paper p-3 font-mono text-xs leading-5 text-ink/60">Hermes Brain → {app.department.replace(/_/g, " ")} → {app.name} → {state.plan.assets.filter((asset) => asset.kind === "loop_spec").length} loops</div>
        <div className="mt-3 break-all text-[0.68rem] text-ink/40">Plan digest {state.plan.planDigest} · expires {new Date(state.plan.expiresAt).toLocaleString()}</div>

        <form action={applyReviewedAppInstallAction} className="mt-6 border-t border-line pt-5">
          <input name="plan" type="hidden" value={JSON.stringify(state.plan)} />
          <input name="expectedPlanDigest" type="hidden" value={state.plan.planDigest} />
          <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1" disabled={!ready} name="confirmPlan" required type="checkbox" /><span>I reviewed this exact plan. Install atomically with provider writes blocked and keep the app in {state.plan.initialMode} mode.</span></label>
          <button className="mt-4 rounded-md bg-signal px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!ready} type="submit">Install {app.name}</button>
        </form>
      </section>
    </div>
  );
}

function QuestionField({ plan, question }: { plan: AppInstallPlan; question: InstallWizardQuestion }) {
  const value = plan.configuration.values[question.key] ?? question.defaultValue;
  const required = question.requirement === "required";
  const common = { id: `config-${question.key}`, name: `config:${question.key}`, required };
  return (
    <label className="block rounded-lg border border-line p-4" htmlFor={common.id}>
      <span className="text-sm font-semibold">{question.prompt}{required ? " *" : ""}</span>
      <span className="mt-1 block text-xs leading-5 text-ink/50">{question.why}{question.inferFromContext ? ` Can reuse ${question.inferFromContext}.` : ""}</span>
      {question.valueType === "boolean" ? (
        <select {...common} className="mt-3 w-full rounded-md border border-line bg-white px-3 py-2 text-sm" defaultValue={displayConfigurationValue(value, question.valueType)}>
          <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      ) : question.valueType === "object" || question.valueType === "string_list" ? (
        <textarea {...common} className="mt-3 min-h-28 w-full rounded-md border border-line px-3 py-2 font-mono text-xs" defaultValue={displayConfigurationValue(value, question.valueType)} placeholder={question.valueType === "object" ? '{"key":"value"}' : "One value per line"} />
      ) : (
        <input {...common} className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" defaultValue={displayConfigurationValue(value, question.valueType)} type={question.valueType === "number" ? "number" : "text"} step={question.valueType === "number" ? "any" : undefined} />
      )}
      {question.confirmWhenInferred && value !== undefined ? <span className="mt-2 block text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-orange-700">Confirm inferred value</span> : null}
    </label>
  );
}

function ReviewColumn({ children, title }: { children: React.ReactNode; title: string }) {
  return <div><h3 className="text-sm font-semibold">{title}</h3><div className="mt-3 space-y-2">{children}</div></div>;
}

function ReviewMetric({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm"><span className="text-ink/55">{label}</span><strong>{value}</strong></div>;
}
