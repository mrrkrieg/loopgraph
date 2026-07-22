import React from "react";
import Link from "next/link";
import { DiscoveryStepNav } from "@/components/discovery-step-nav";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import {
  formatDepartmentType,
  type DiscoveryAnswer,
  type QuestionBundleField
} from "loopgraph/core";
import { getNextDiscoveryQuestions } from "loopgraph/runtime";
import { getActiveLoopgraphProjectRoot } from "../../../lib/loopgraph-runtime/storage-resolver";
import { submitBrowserDiscoveryAnswersAction } from "../actions";
import {
  getDiscoverySessionIdFromSearchParams,
  getHermesDiscoverySessionForView,
  type DiscoverySearchParams
} from "../view-data";

export default async function DiscoveryQuestionsPage({ searchParams }: { searchParams?: DiscoverySearchParams }) {
  const sessionId = await getDiscoverySessionIdFromSearchParams(searchParams);
  const session = sessionId ? await getHermesDiscoverySessionForView(sessionId) : undefined;
  const next = sessionId && session
    ? await getNextDiscoveryQuestions({ projectRoot: getActiveLoopgraphProjectRoot(), sessionId })
    : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title="Questions"
        description="Answer the same five compact question bundles Hermes asks through MCP. Each save uses the session revision so browser and Hermes writes cannot silently overwrite each other."
      />
      <DiscoveryStepNav activeHref="/discovery/questions" sessionId={sessionId} />

      {!sessionId || !session ? (
        <SectionCard title={sessionId ? "Session not found" : "Start or choose a real session"}>
          <p className="text-sm leading-6 text-ink/65">
            Question bundles are only available for real project-local Hermes/browser sessions. Start or resume one from the discovery home.
          </p>
          <Link className="mt-4 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" href="/discovery">
            Open discovery home
          </Link>
        </SectionCard>
      ) : next?.nextAction === "select_department" ? (
        <SectionCard title="Choose a department first" description="The five question bundles become department-aware after a department is selected.">
          <Link
            className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            href={`/discovery/departments?sessionId=${encodeURIComponent(session.id)}`}
          >
            Choose departments
          </Link>
        </SectionCard>
      ) : next?.nextAction === "design_context_ready" ? (
        <SectionCard
          title="Ready for design"
          description="The main question bundles are complete. The next stage is compiling a design context for Hermes-hosted high reasoning or browser deterministic fallback."
        >
          <div className="flex flex-wrap gap-2 text-sm">
            <StatusPill>{next.answeredBundleCount} of {next.totalBundleCount} bundles answered</StatusPill>
            {next.activeDepartmentId ? <StatusPill>{formatDepartmentType(next.activeDepartmentId)}</StatusPill> : null}
            <StatusPill>Revision {next.revision}</StatusPill>
          </div>
          <p className="mt-4 text-sm leading-6 text-ink/65">
            Next, Loopgraph compiles a bounded design context and creates proposals that Hermes can review, submit, or use as the local deterministic fallback.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
              href={`/discovery/designing?sessionId=${encodeURIComponent(session.id)}`}
            >
              Open Hermes designing step
            </Link>
            <Link
              className="text-sm font-medium text-ink/60 hover:text-ink"
              href={`/discovery/create-loops?sessionId=${encodeURIComponent(session.id)}`}
            >
              Review existing proposals
            </Link>
          </div>
        </SectionCard>
      ) : next?.bundle && next.activeDepartmentId ? (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <SectionCard
            title={next.bundle.prompt}
            description={next.bundle.whyAsked}
          >
            <form action={submitBrowserDiscoveryAnswersAction} className="space-y-5">
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="bundleId" value={next.bundle.id} />
              <input type="hidden" name="expectedRevision" value={next.revision} />
              {next.bundle.fields.map((field) => (
                <QuestionField
                  key={field.id}
                  field={field}
                  previousAnswer={session.answers.find((answer) =>
                    answer.questionId === `${next.bundle?.id}.${field.id}`
                  )}
                />
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
                  Save answers
                </button>
                <Link
                  className="text-sm font-medium text-ink/60 hover:text-ink"
                  href={`/discovery/departments?sessionId=${encodeURIComponent(session.id)}`}
                >
                  Change departments
                </Link>
              </div>
            </form>
          </SectionCard>

          <div className="space-y-5">
            <SectionCard title="Progress" description={`${formatDepartmentType(next.activeDepartmentId)} discovery`}>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <StatusPill>{next.answeredBundleCount} of {next.totalBundleCount} answered</StatusPill>
                  <StatusPill>Revision {next.revision}</StatusPill>
                </div>
                <ol className="space-y-2">
                  {next.bundleSummary.map((item) => {
                    const queueItem = session.questionQueue.find((queue) => queue.bundleId === item.id);
                    return (
                      <li key={item.id} className="rounded-md border border-line bg-paper px-3 py-2">
                        <div className="font-medium text-ink">{item.order}. {shortBundleLabel(item.id)}</div>
                        <div className="mt-1 text-ink/55">{queueItem?.status ?? "pending"}</div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </SectionCard>

            <SectionCard title="Department-specific prompts" description="These guide Hermes/browser follow-ups without turning discovery into a long form.">
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink/65">
                {next.departmentBranchQuestions.map((question) => <li key={question}>{question}</li>)}
              </ol>
            </SectionCard>
          </div>
        </div>
      ) : (
        <SectionCard title="No active question bundle">
          <p className="text-sm leading-6 text-ink/65">
            The session has no active bundle. Return to Departments to reset the active department or continue from the discovery home.
          </p>
        </SectionCard>
      )}
    </>
  );
}

function QuestionField({
  field,
  previousAnswer
}: {
  field: QuestionBundleField;
  previousAnswer?: DiscoveryAnswer;
}) {
  const defaultValue = valueToInputDefault(previousAnswer?.value);
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">
        {field.label}
        {field.required ? <span className="text-red-600"> *</span> : null}
      </span>
      <span className="mt-1 block text-sm leading-6 text-ink/60">{field.prompt}</span>
      <span className="mt-2 block">
        {renderFieldControl(field, defaultValue)}
      </span>
    </label>
  );
}

function renderFieldControl(field: QuestionBundleField, defaultValue: string) {
  const className = "min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ink";
  if (field.options?.length) {
    return (
      <select className={className} name={field.id} defaultValue={defaultValue}>
        <option value="">Choose one</option>
        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.valueType === "boolean") {
    return (
      <select className={className} name={field.id} defaultValue={defaultValue}>
        <option value="">Choose one</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.valueType === "number") {
    return <input className={className} name={field.id} type="number" step="any" defaultValue={defaultValue} />;
  }
  if (field.valueType === "string_array") {
    return (
      <textarea
        className={`${className} min-h-28`}
        name={field.id}
        defaultValue={defaultValue}
        placeholder="One per line or comma-separated"
      />
    );
  }
  return <textarea className={`${className} min-h-24`} name={field.id} defaultValue={defaultValue} />;
}

function valueToInputDefault(value: unknown): string {
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function shortBundleLabel(bundleId: string): string {
  return bundleId
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
