import Link from "next/link";
import { SectionCard } from "@/components/section-card";
import { getDemoWorkspace } from "@/lib/loop-engineering-builder/demo-data";
import { saveAnswersAndGenerateSpecAction } from "./actions";

export default function LoopQuestionsPage() {
  const workspace = getDemoWorkspace();

  return (
    <div className="grid gap-5">
      <SectionCard title="Question progress" description="Department-specific requirements are grouped by the loop sections needed for a valid spec.">
        <div className="h-3 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-signal" style={{ width: `${workspace.progress.percent}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-ink/65">
          <span>{workspace.progress.answered} of {workspace.progress.totalRequired} required answers</span>
          <Link href={`/loops/${workspace.loop.id}/spec`} className="font-semibold text-ink hover:underline">
            Generate spec
          </Link>
        </div>
      </SectionCard>

      <form action={saveAnswersAndGenerateSpecAction} className="grid gap-5">
        <input type="hidden" name="loop_id" value={workspace.loop.id} />
        {workspace.questions.map((group) => (
          <SectionCard key={group.section} title={group.section}>
            <div className="grid gap-3">
              {group.questions.map((question) => (
                <label key={question.questionKey} className="block rounded-md border border-line bg-paper p-3 text-sm">
                  <span className="font-medium">{question.question}</span>
                  {question.helpText ? <span className="mt-1 block text-xs text-ink/55">{question.helpText}</span> : null}
                  {question.answerType === "select" ? (
                    <select name={question.questionKey} className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2" defaultValue={workspace.answers[question.questionKey]}>
                      {question.options?.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      name={question.questionKey}
                      className="mt-2 min-h-20 w-full rounded-md border border-line bg-white px-3 py-2"
                      defaultValue={workspace.answers[question.questionKey] ?? ""}
                    />
                  )}
                </label>
              ))}
            </div>
          </SectionCard>
        ))}
        <div>
          <button className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" type="submit">
            Save answers and generate spec
          </button>
        </div>
      </form>
    </div>
  );
}
