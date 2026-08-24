"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AppFieldMappingPlan, AppInstallPlan } from "loopgraph/core";
import {
  displayConfigurationValue,
  installPlanBlockersForView,
  type InstallWizardApp,
  type AppInstallImpactView,
  type AppOnboardingProgressView,
  type InstallWizardQuestion,
  type InstallWizardState
} from "@/lib/app-platform/install-wizard";
import {
  applyReviewedAppInstallAction,
  confirmAppFieldMappingsAction,
  planMarketplaceAppInstallAction,
  resetMarketplaceAppOnboardingAction
} from "@/app/marketplace/[appId]/install/actions";
import { AppOnboardingProgress } from "@/components/apps/app-onboarding-progress";
import { InstallImpactReview } from "@/components/apps/install-impact-review";

export function InstallWizard({ app, initialPlan, initialImpact, initialJourney, initialQuestionKeys, mappingPlan }: { app: InstallWizardApp; initialPlan: AppInstallPlan; initialImpact: AppInstallImpactView; initialJourney: AppOnboardingProgressView; initialQuestionKeys: string[]; mappingPlan: AppFieldMappingPlan }) {
  const initialState: InstallWizardState = { stage: "configure", plan: initialPlan, impact: initialImpact, mappingPlan, journey: initialJourney, unresolvedQuestionKeys: initialQuestionKeys };
  const [state, planAction, isPlanning] = useActionState(planMarketplaceAppInstallAction, initialState);
  const blockers = installPlanBlockersForView(state.plan);
  const ready = blockers.length === 0;
  const activeMappingPlan = state.mappingPlan;
  const unresolvedQuestions = app.questions.filter((question) => state.unresolvedQuestionKeys.includes(question.key));
  const draftTransition = Boolean(state.journey.draft && !state.journey.draft.applied);
  const savedAnswerKeys = new Set(state.journey.draft?.applied ? state.journey.draft.answerKeys : []);
  const savedQuestions = app.questions.filter((question) =>
    savedAnswerKeys.has(question.key) && !state.unresolvedQuestionKeys.includes(question.key));

  return (
    <div className="space-y-6">
      <AppOnboardingProgress journey={state.journey} />
      {state.journey.draft ? (
        <div className={`rounded-lg border px-4 py-3 text-sm ${draftTransition ? "border-orange-200 bg-orange-50 text-orange-950" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
          <div>{draftTransition
            ? `You are previewing ${app.preset.name} instead of the saved ${state.journey.draft.presetId} stack. Saved answers and mapping IDs are not applied to this preview.`
            : `Saved onboarding progress · revision ${state.journey.draft.revision} · ${new Date(state.journey.draft.savedAt).toLocaleString()}. You can leave this page and resume without re-answering completed questions.`}</div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold">Start this App setup over</summary>
            <form action={resetMarketplaceAppOnboardingAction} className="mt-3 rounded-md border border-blue-200 bg-white/70 p-3">
              <input name="appId" type="hidden" value={app.id} />
              <input name="presetId" type="hidden" value={app.preset.id} />
              <input name="expectedDraftId" type="hidden" value={state.journey.draft.id} />
              <input name="expectedDraftRevision" type="hidden" value={state.journey.draft.revision} />
              <label className="flex items-start gap-2 text-xs leading-5"><input className="mt-1" name="confirmReset" required type="checkbox" /><span>Clear only these saved setup choices. Connected systems, confirmed reusable mappings, approved company context, and installed Apps will not change.</span></label>
              <button className="mt-3 rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-semibold hover:border-blue-600" type="submit">Clear saved setup choices</button>
            </form>
          </details>
        </div>
      ) : null}
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
                    <span>
                      <span className="block text-sm font-semibold">{module.name}</span>
                      <span className="mt-1 block text-xs leading-5 text-ink/55">{module.description}</span>
                      <span className="mt-1 block text-[0.68rem] font-medium text-ink/40">{module.dependsOn.length > 0 ? `Requires ${module.dependsOn.join(", ")}` : "Independent module"}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {draftTransition ? (
            <label className="mt-6 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm leading-6 text-orange-950">
              <input className="mt-1" name="confirmPresetChange" required type="checkbox" />
              <span>Replace the saved <strong>{state.journey.draft!.presetId}</strong> setup choices with this <strong>{app.preset.id}</strong> stack when I save the plan. Shared connections, confirmed mappings, approved company context, installed Apps, and runtime state remain unchanged.</span>
            </label>
          ) : null}

          <fieldset className="mt-7 border-t border-line pt-6">
            <legend className="text-sm font-semibold">Step 2 · company-specific answers</legend>
            <p className="mt-2 text-sm leading-6 text-ink/55">Preset and approved company-context values are filled in first. Confirm or change only what is specific to this installation.</p>
            {unresolvedQuestions.length > 0 ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {unresolvedQuestions.map((question) => (
                  <QuestionField key={question.key} plan={state.plan} question={question} />
                ))}
              </div>
            ) : <div className="mt-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">No company-specific questions are unresolved.</div>}
            {savedQuestions.length > 0 ? (
              <details className="mt-4 rounded-lg border border-line bg-paper p-4">
                <summary className="cursor-pointer text-sm font-semibold">Review or change {savedQuestions.length} saved {savedQuestions.length === 1 ? "answer" : "answers"}</summary>
                <p className="mt-2 text-xs leading-5 text-ink/50">These values came from this onboarding draft, not provider credentials or unapproved inference. Clearing a field removes it from the next saved snapshot.</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {savedQuestions.map((question) => (
                    <QuestionField key={question.key} plan={state.plan} question={question} />
                  ))}
                </div>
              </details>
            ) : null}
          </fieldset>

          {state.error ? <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{state.error}</div> : null}
          <button className="mt-6 rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60" disabled={isPlanning} type="submit">
            {isPlanning ? "Validating answers…" : "Create exact install plan"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Step 3 · field mappings</div>
        <h2 className="mt-2 text-xl font-semibold">Confirm how provider fields map to company objects</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">Hermes can suggest mappings from a connection-bound schema snapshot. Nothing becomes trusted until you confirm it, and confirmed mappings can be reused by later apps.</p>
        {activeMappingPlan.requirements.length === 0 ? (
          <div className="mt-4 rounded-md bg-paper px-4 py-3 text-sm text-ink/60">This app does not require provider field mappings.</div>
        ) : (
          <div className="mt-5 space-y-5">
            {activeMappingPlan.requirements.map((requirement) => (
              <FieldMappingRequirement appId={app.id} key={`${requirement.recipeId}:${requirement.objectType}`} presetId={app.preset.id} requirement={requirement} />
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-xl border p-5 sm:p-6 ${ready ? "border-emerald-300 bg-emerald-50" : "border-orange-300 bg-orange-50"}`}>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Step 4 · readiness</div>
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
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">Step 5 · exact transaction review</div>
        <h2 className="mt-2 text-xl font-semibold">Review the complete App impact</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">This is the content-bound transaction Hermes and Loopgraph will apply. Nothing below is inferred after you approve it.</p>
        <InstallImpactReview appName={app.name} department={app.department} impact={state.impact} plan={state.plan} />
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

function FieldMappingRequirement({
  appId,
  presetId,
  requirement
}: {
  appId: string;
  presetId: string;
  requirement: AppFieldMappingPlan["requirements"][number];
}) {
  if (!requirement.connectionId) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
        <div className="text-sm font-semibold capitalize">{requirement.providerId} · {requirement.objectType.replace(/_/g, " ")}</div>
        <p className="mt-1 text-sm leading-6 text-ink/60">{requirement.connectorOnboarding === "available" ? "Connect this provider through the Hermes Connector Broker first. Hermes will then inspect its bounded object schema and suggest exact mappings." : "This provider is part of the preset but does not yet have a built-in Connector Broker onboarding profile. Register a capability-scoped custom connector or choose another preset."}</p>
        {requirement.connectorOnboarding === "available" ? <Link className="mt-3 inline-flex rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white" href={`/settings/integrations?provider=${encodeURIComponent(requirement.providerId)}`}>Connect {requirement.providerId}</Link> : <span className="mt-3 inline-flex rounded-full border border-orange-300 px-3 py-1.5 text-xs font-semibold text-orange-800">Custom connector required</span>}
      </div>
    );
  }

  const complete = requirement.missingRequiredFields.length === 0 && requirement.unverifiedRequiredFields.length === 0;
  if (complete) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold capitalize">{requirement.providerId} · {requirement.objectType.replace(/_/g, " ")}</span>
          <span className="rounded-full border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-800">Confirmed</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {requirement.existingMappings
            .filter((mapping) => requirement.requiredLogicalFields.includes(mapping.logicalField))
            .map((mapping) => <div className="rounded-md bg-white/70 px-3 py-2 font-mono text-xs" key={mapping.id}>{mapping.logicalField} → {mapping.providerField}</div>)}
        </div>
      </div>
    );
  }

  return (
    <form action={confirmAppFieldMappingsAction} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
      <input name="appId" type="hidden" value={appId} />
      <input name="presetId" type="hidden" value={presetId} />
      <input name="connectionId" type="hidden" value={requirement.connectionId} />
      <input name="objectType" type="hidden" value={requirement.objectType} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold capitalize">{requirement.providerId} · {requirement.objectType.replace(/_/g, " ")}</div>
          <p className="mt-1 text-xs leading-5 text-ink/55">{requirement.schemaStatus === "connected_snapshot" ? `Live schema inspected ${new Date(requirement.snapshotInspectedAt!).toLocaleString()}.` : "Using connector metadata until Hermes records a live provider schema snapshot."}</p>
        </div>
        <span className="rounded-full border border-orange-300 px-2.5 py-1 text-xs font-semibold text-orange-800">Confirmation required</span>
      </div>
      <div className="mt-4 space-y-3">
        {requirement.requiredLogicalFields.map((logicalField) => {
          const existing = requirement.existingMappings.find((mapping) => mapping.logicalField === logicalField);
          const suggestion = requirement.suggestions.find((candidate) => candidate.logicalField === logicalField);
          const defaultValue = existing?.providerField ?? suggestion?.providerField ?? "";
          return (
            <label className="grid gap-2 rounded-md border border-black/10 bg-white/75 p-3 md:grid-cols-[minmax(12rem,0.8fr)_minmax(14rem,1fr)] md:items-center" key={logicalField}>
              <span>
                <span className="block font-mono text-xs font-semibold">{logicalField}</span>
                <span className="mt-1 block text-[0.68rem] leading-4 text-ink/45">{suggestion?.reason ?? "Select the exact provider field."}</span>
              </span>
              <span>
                <input name="logicalField" type="hidden" value={logicalField} />
                <input name={`confidence:${logicalField}`} type="hidden" value={suggestion?.confidence ?? existing?.confidence ?? 0} />
                <select className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm" defaultValue={defaultValue} name={`providerField:${logicalField}`} required>
                  <option value="">Choose provider field…</option>
                  {requirement.providerFields.map((field) => (
                    <option key={field.name} value={field.name}>{field.label ? `${field.label} (${field.name})` : field.name}{field.sampleValues.length > 0 ? ` · e.g. ${String(field.sampleValues[0])}` : ""}</option>
                  ))}
                </select>
              </span>
            </label>
          );
        })}
      </div>
      <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-ink/65"><input className="mt-1" name="confirmMappings" required type="checkbox" /><span>I checked these fields against the connected provider. Save them as reusable workspace mappings.</span></label>
      <button className="mt-4 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">Confirm {requirement.objectType.replace(/_/g, " ")} mappings</button>
    </form>
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
