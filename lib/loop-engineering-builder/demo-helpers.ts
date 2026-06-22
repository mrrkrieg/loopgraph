import { generateQuestions, type AnswerMap, type QuestionGroup } from "./question-engine";
import type { DepartmentKey } from "./types";

export function generateLoopQuestions(
  department: DepartmentKey,
  templateId: string,
  goal: string
) {
  return generateQuestions(department, templateId, goal);
}

export function questionProgress(groups: QuestionGroup[], answers: AnswerMap) {
  const questions = groups.flatMap((group) => group.questions);
  const required = questions.filter((question) => question.required);
  const answered = required.filter((question) => {
    const answer = answers[question.questionKey];
    return answer && answer.trim().length > 0;
  });

  return {
    totalRequired: required.length,
    answered: answered.length,
    missing: required.length - answered.length,
    percent: Math.round((answered.length / Math.max(required.length, 1)) * 100)
  };
}

export function formatDate(value?: string) {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
