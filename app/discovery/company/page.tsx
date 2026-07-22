import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { inspectProjectManifests } from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../lib/loopgraph-runtime/storage-resolver";
import { confirmBrowserDiscoveryProjectContextAction } from "../actions";
import {
  getDiscoverySessionIdFromSearchParams,
  getDiscoverySessionForView,
  getHermesDiscoverySessionForView,
  type DiscoverySearchParams
} from "../view-data";

export default async function CompanyDiscoveryPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const sessionId = await getDiscoverySessionIdFromSearchParams(searchParams);
  const realSession = sessionId ? await getHermesDiscoverySessionForView(sessionId) : undefined;
  const session = realSession ?? await getDiscoverySessionForView(sessionId);
  const company = session.companyProfile;
  const projectRoot = getActiveLoopgraphProjectRoot();
  const inspection = realSession ? await inspectProjectManifests({ projectRoot }) : undefined;
  const projectProfile = realSession?.projectProfile;
  const detectedStack = projectProfile
    ? [
        ...projectProfile.languages,
        ...projectProfile.frameworks,
        ...projectProfile.datastores,
        ...projectProfile.detectedIntegrationHints
      ]
    : inspection
      ? [
          ...inspection.stack.languages,
          ...inspection.stack.frameworks,
          ...inspection.stack.databases,
          ...inspection.stack.analytics,
          ...inspection.stack.cms,
          ...inspection.stack.auth,
          ...inspection.stack.ai
        ]
      : [];

  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Project context"
        description="Confirm the safe stack summary Hermes and the browser use before department questions. Detectors read allowlisted manifests only, never secret files."
      />
      <DiscoveryStepNav activeHref="/discovery/company" sessionId={sessionId} />

      {!realSession ? (
        <SectionCard title="Start or choose a real session" description="Project confirmation is available for shared Hermes/browser sessions. The demo profile remains read-only.">
          <p className="text-sm leading-6 text-ink/65">
            Start a real session from the discovery home, then confirm the detected project context before choosing departments.
          </p>
          <Link className="mt-4 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">
            Open discovery home
          </Link>
        </SectionCard>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <SectionCard
            title={projectProfile?.confirmedByUser ? "Project context confirmed" : "Confirm project context"}
            description="This stores a ProjectProfile on the shared discovery session. It helps Hermes summarize stack context, but it does not grant connector access or satisfy business approval questions."
          >
            <form action={confirmBrowserDiscoveryProjectContextAction} className="space-y-5">
              <input type="hidden" name="sessionId" value={realSession.id} />
              <input type="hidden" name="expectedRevision" value={realSession.revision} />
              <TextField label="Display name" name="displayName" defaultValue={projectProfile?.displayName ?? company?.name ?? ""} />
              <TextArea label="What does the company or project do?" name="companyDescription" defaultValue={company?.description ?? ""} />
              <TextField label="Customer or user type" name="customerType" defaultValue={company?.customerType ?? ""} />
              <TextField label="Main goal this quarter" name="primaryGoal" defaultValue={company?.primaryGoal ?? ""} />
              <TextField label="North-star metric" name="northStarMetric" defaultValue={company?.northStarMetric ?? ""} />
              <TextArea
                label="Business source of truth"
                name="sourceOfTruth"
                defaultValue={answerValue(realSession, "project_context.source_of_truth")}
                placeholder="For example: HubSpot defines qualified leads; Notion contains approved content briefs."
              />
              <TextArea
                label="Corrections or additional tools"
                name="additionalTools"
                defaultValue=""
                placeholder="One per line. Add only non-secret tool/system names."
              />
              <TextArea
                label="Confirmation notes"
                name="confirmationNotes"
                defaultValue={answerValue(realSession, "project_context.confirmation_notes")}
                placeholder="Anything Hermes should know about inaccurate detections or important context."
              />
              <label className="flex gap-3 rounded-md border border-line bg-canvas p-3 text-sm text-ink/70">
                <input className="mt-1" type="checkbox" name="confirmedStack" defaultChecked={projectProfile?.confirmedByUser ?? true} />
                <span>I confirm this detected stack summary is safe to use as project context. It contains no credentials and does not authorize live connector reads or writes.</span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
                  Save project context
                </button>
                <Link
                  className="text-sm font-medium text-ink/60 hover:text-ink"
                  href={`/discovery/departments?sessionId=${encodeURIComponent(realSession.id)}`}
                >
                  Continue to departments
                </Link>
              </div>
            </form>
          </SectionCard>

          <div className="space-y-5">
            <SectionCard title="Safe detected stack" description="Names only from allowlisted manifests; secret files are ignored.">
              <div className="flex flex-wrap gap-2">
                {dedupe(detectedStack).length > 0
                  ? dedupe(detectedStack).map((item) => <StatusPill key={item}>{item}</StatusPill>)
                  : <span className="text-sm text-ink/45">No stack hints detected yet</span>}
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <Field label="Project root ID" value={projectProfile?.projectRootId ?? inspection?.projectRootId} />
                <Field label="Repo type" value={projectProfile?.repoType ?? "Pending confirmation"} />
                <Field label="Inspection policy" value={inspection ? `secretsRead=${inspection.policy.secretsRead}; allowlistedManifestOnly=${inspection.policy.allowlistedManifestOnly}` : undefined} />
              </dl>
            </SectionCard>

            <SectionCard title="Manifest evidence" description="Hermes receives evidence references, not raw unrestricted files.">
              <ul className="space-y-2 text-sm leading-6 text-ink/65">
                {(projectProfile?.manifestEvidence ?? inspection?.evidence.map((item) => ({
                  path: item.path,
                  detector: item.kind,
                  confidence: 0.7
                })) ?? []).slice(0, 8).map((item) => (
                  <li key={`${item.detector}:${item.path}`} className="rounded-md border border-line bg-white px-3 py-2">
                    <span className="font-medium text-ink">{item.path}</span>
                    <span className="ml-2 text-ink/45">{item.detector} · {Math.round(item.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
              {inspection?.policy.ignoredPaths.length ? (
                <div className="mt-4 text-sm text-ink/55">
                  Ignored secret-like files: {inspection.policy.ignoredPaths.join(", ")}
                </div>
              ) : null}
            </SectionCard>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</dt>
      <dd className="mt-1 leading-6 text-ink">{value ?? "Missing"}</dd>
    </div>
  );
}

function TextField({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <input
        className="mt-2 min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
        name={name}
        defaultValue={defaultValue}
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <textarea
        className="mt-2 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </label>
  );
}

function answerValue(session: { answers: Array<{ questionId: string; value?: unknown }> }, questionId: string): string {
  const value = session.answers.find((answer) => answer.questionId === questionId)?.value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("\n");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return "";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}
