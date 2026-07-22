import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import type { BusinessDiscoverySession } from "loopgraph/core";
import { startBrowserDiscoverySessionAction } from "./actions";
import {
  discoverySteps,
  getDiscoverySessionIdFromSearchParams,
  getDiscoverySessionForView,
  getHermesDiscoverySessionForView,
  getHermesDiscoverySessionsForView,
  type DiscoverySearchParams
} from "./view-data";

type DiscoveryPageProps = {
  searchParams?: DiscoverySearchParams;
};

export default async function DiscoveryPage({ searchParams }: DiscoveryPageProps) {
  const selectedSessionId = await getDiscoverySessionIdFromSearchParams(searchParams);
  const [demoSession, realSessions] = await Promise.all([
    getDiscoverySessionForView(),
    getHermesDiscoverySessionsForView()
  ]);
  const selectedRealSession = selectedSessionId
    ? (realSessions.find((item) => item.id === selectedSessionId) ?? await getHermesDiscoverySessionForView(selectedSessionId))
    : realSessions[0];
  const session = selectedRealSession ?? demoSession;
  const sessionMode = selectedRealSession ? "real" : "demo";
  const answeredQuestionCount = session.questionQueue.filter((item) => item.status === "answered").length;
  const totalQuestionCount = session.questionQueue.length;
  const questionsComplete = totalQuestionCount > 0 && answeredQuestionCount === totalQuestionCount;
  const completedSteps = [
    selectedRealSession ? "Start" : undefined,
    selectedRealSession?.projectProfileId ? "Project" : undefined,
    session.selectedDepartmentIds.length ? "Departments" : undefined,
    questionsComplete ? "Questions" : undefined,
    selectedRealSession && (session.activeStage === "design_context" || session.designRunIds.length || session.createdLoopIds.length) ? "Designing" : undefined,
    session.designRunIds.length || session.createdLoopIds.length ? "Hermes Loops" : undefined
  ].filter(Boolean).length;

  return (
    <>
      <PageHeader
        eyebrow="Business discovery"
        title="Discovery"
        description="Create or resume the same project-local discovery sessions used by Hermes Agent, then turn accepted designs into governed loops."
        action={
          <Link
            className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            href={selectedRealSession
              ? nextSessionHref(selectedRealSession)
              : "/discovery"}
          >
            Create Hermes loops
          </Link>
        }
      />
      <DiscoveryStepNav activeHref="/discovery" sessionId={selectedRealSession?.id} />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Shared sessions" value={realSessions.length} note="Project-local Hermes/browser sessions" />
        <MetricCard label="Progress" value={`${Math.round((completedSteps / discoverySteps.length) * 100)}%`} note={`${completedSteps} of ${discoverySteps.length} Hermes steps have data in ${sessionMode} view`} />
        <MetricCard label="Departments" value={session.departmentProfiles.length} note={selectedRealSession ? "Selected in this real session" : "Demo fixture departments"} />
        <MetricCard label="Design runs" value={session.designRunIds.length} note={selectedRealSession ? "Proposal sets generated for Hermes review" : "Start a real session for Hermes proposals"} />
      </div>

      <div className="mt-6">
        <SectionCard
          title="Shared Hermes/browser sessions"
          description="Hermes and the browser now read and write the same project-local discovery session files. Start here for real work; the Acme data below is only a labeled demo fallback."
        >
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <form action={startBrowserDiscoverySessionAction} className="rounded-lg border border-line bg-canvas p-4">
              <label className="block text-sm font-semibold text-ink" htmlFor="companyName">
                Start a real discovery session
              </label>
              <p className="mt-1 text-sm leading-6 text-ink/60">
                This creates a persistent `.loopgraph/discovery` session that Hermes can resume through MCP.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  id="companyName"
                  name="companyName"
                  placeholder="Company name, optional"
                  className="min-h-10 flex-1 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-ink"
                />
                <button type="submit" className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
                  New real session
                </button>
              </div>
            </form>

            <div className="rounded-lg border border-line bg-white">
              {realSessions.length > 0 ? (
                <ul className="divide-y divide-line">
                  {realSessions.map((item) => (
                    <li key={item.id} className="p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/discovery?sessionId=${encodeURIComponent(item.id)}`}
                              className="font-semibold text-ink hover:underline"
                            >
                              {sessionDisplayName(item)}
                            </Link>
                            {selectedRealSession?.id === item.id ? <StatusPill>Selected</StatusPill> : null}
                            <StatusPill>{item.createdByActor === "hermes" ? "Hermes-started" : `${formatActor(item.createdByActor)}-started`}</StatusPill>
                          </div>
                          <p className="mt-1 font-mono text-xs text-ink/45">{item.id}</p>
                          <p className="mt-2 text-sm leading-6 text-ink/65">
                            Stage: {formatStage(item.activeStage)} · Revision {item.revision} · Updated {formatIsoMinute(item.updatedAt)}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.selectedDepartmentIds.length > 0
                              ? item.selectedDepartmentIds.map((department) => <StatusPill key={department}>{department.replaceAll("_", " ")}</StatusPill>)
                              : <span className="text-sm text-ink/45">No departments selected yet</span>}
                          </div>
                        </div>
                        <Link
                          href={nextSessionHref(item)}
                          className="rounded-md border border-line px-3 py-2 text-center text-sm font-semibold text-ink/70 hover:border-ink hover:text-ink"
                        >
                          Continue
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-4 text-sm leading-6 text-ink/60">
                  No real discovery sessions exist in this project yet. Start one here or ask Hermes to design automations for a department.
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionCard
          title={selectedRealSession ? "Selected real session" : "Demo discovery profile"}
          description={session.companyProfile?.name ?? (selectedRealSession ? session.id : "Acme SaaS fixture")}
        >
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Company</dt>
              <dd className="mt-1 font-medium text-ink">{session.companyProfile?.description ?? "Not answered yet"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Goal</dt>
              <dd className="mt-1 font-medium text-ink">{session.companyProfile?.primaryGoal ?? "Not answered yet"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">Tools</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {session.companyProfile?.tools.length
                  ? session.companyProfile.tools.map((tool) => <StatusPill key={tool}>{tool}</StatusPill>)
                  : <span className="text-ink/45">Not answered yet</span>}
              </dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title={selectedRealSession ? "Next real-session action" : "Hermes-first flow"}>
          <div className="text-sm leading-6 text-ink/70">
            {selectedRealSession
              ? nextActionCopy(selectedRealSession)
              : "Start a real session, choose departments, answer the five bundles, then let Hermes review or generate local loop proposals."}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {discoverySteps.map((step) => (
              <Link
                key={step.href}
                href={selectedRealSession ? `${step.href}?sessionId=${encodeURIComponent(selectedRealSession.id)}` : step.href}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink/70 hover:border-ink hover:text-ink"
              >
                {step.label}
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function nextSessionHref(session: BusinessDiscoverySession): string {
  if (!session.projectProfileId) return `/discovery/company?sessionId=${encodeURIComponent(session.id)}`;
  if (!session.activeDepartmentId) return `/discovery/departments?sessionId=${encodeURIComponent(session.id)}`;
  if (session.activeQuestionBundleId) return `/discovery/questions?sessionId=${encodeURIComponent(session.id)}`;
  if (session.activeStage === "design_context" || session.designRunIds.length === 0) {
    return `/discovery/designing?sessionId=${encodeURIComponent(session.id)}`;
  }
  return `/discovery/create-loops?sessionId=${encodeURIComponent(session.id)}`;
}

function sessionDisplayName(session: BusinessDiscoverySession): string {
  return session.companyProfile?.name ?? session.id;
}

function formatActor(actor: BusinessDiscoverySession["createdByActor"]): string {
  return actor.charAt(0).toUpperCase() + actor.slice(1);
}

function formatStage(stage: BusinessDiscoverySession["activeStage"]): string {
  return stage.replaceAll("_", " ");
}

function formatIsoMinute(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

function nextActionCopy(session: BusinessDiscoverySession): string {
  if (!session.projectProfileId) {
    return "Confirm the project context and safe detected stack before choosing departments.";
  }
  if (!session.activeDepartmentId) {
    return "Choose the department Hermes or the browser should design automations for first.";
  }
  if (session.activeQuestionBundleId) {
    return `Answer the ${session.activeQuestionBundleId.replaceAll("_", " ")} bundle for ${session.activeDepartmentId.replaceAll("_", " ")}.`;
  }
  if (session.activeStage === "design_context") {
    return "The discovery answers are ready for a Hermes-hosted or local deterministic design run.";
  }
  if (session.activeStage === "proposal_review") {
    return "Review the proposed Hermes loops, accept the useful ones, and materialize them into the local graph.";
  }
  if (session.activeStage === "materialization") {
    return "The accepted loops were materialized locally. Connect data to Hermes and run local simulations before live routing.";
  }
  return "Resume this shared session from Hermes or continue through the browser steps.";
}
