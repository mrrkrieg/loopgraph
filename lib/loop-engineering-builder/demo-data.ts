import { demoLoopBundle, generateManagementReview } from "./agent";
import { generateLoopQuestions, questionProgress } from "./demo-helpers";
import { buildLoopGraph, createCatalogImprovementItems, createCatalogLoopRecords } from "./graph";
import { getDepartmentTemplates } from "./templates";
import type { ImprovementItem, WorkspaceData } from "./types";

export function getDemoWorkspace(): WorkspaceData {
  const bundle = demoLoopBundle();
  const loops = createCatalogLoopRecords(bundle.loop.organizationId);
  const questions = generateLoopQuestions(bundle.loop.department, bundle.loop.templateId, bundle.loop.goal);
  const progress = questionProgress(questions, bundle.answers);
  const improvements: ImprovementItem[] = [
    {
      id: "improvement_proxy_metric",
      loopId: bundle.loop.id,
      title: "Add downstream quality guardrail",
      description:
        "The run found that click volume can improve while qualified conversion weakens.",
      failureMode: "proxy metric trap",
      recommendation:
        "Require activation or qualified conversion to move with CAC before spend scaling is recommended.",
      status: "open",
      owner: "Marketing lead",
      createdAt: "2026-06-22T15:00:00.000Z"
    },
    {
      id: "improvement_review_time",
      loopId: bundle.loop.id,
      title: "Track human review minutes",
      description:
        "The loop can estimate value only when hidden labor is recorded consistently.",
      failureMode: "missing measurement",
      recommendation:
        "Add review, rework, escalation, governance, and botsitting minutes to every human review.",
      status: "open",
      owner: "Operations owner",
      createdAt: "2026-06-22T16:00:00.000Z"
    },
    ...createCatalogImprovementItems(loops)
  ];
  const managementReview = generateManagementReview();
  const metrics = [
    {
      name: "Baseline time",
      value: "7.5h",
      note: "Weekly manual campaign analysis and reporting."
    },
    {
      name: "Loop-assisted time",
      value: "3.1h",
      note: "Human execution after generation, verification, and review."
    },
    {
      name: "Review time",
      value: "48m",
      note: "Approvals for spend, brand, and claims."
    },
    {
      name: "Rework time",
      value: "34m",
      note: "Corrections after verification or reviewer edits."
    },
    {
      name: "Botsitting time",
      value: "22m",
      note: "Context setup, reruns, cleanup, and manual transfer."
    },
    {
      name: "Relationship-time redeployment",
      value: "1.6h",
      note: "Observed time moved into customer and sales feedback review."
    }
  ];

  return {
    organization: {
      id: "org_demo",
      name: "Acme Loops"
    },
    profile: {
      id: "profile_demo",
      email: "operator@example.com",
      fullName: "Loop Operator",
      role: "owner"
    },
    templates: getDepartmentTemplates(),
    ...bundle,
    loops,
    questions,
    progress,
    improvements,
    managementReview,
    metrics,
    graph: buildLoopGraph({
      organization: {
        id: "org_demo",
        name: "Acme Loops"
      },
      loops,
      reviews: bundle.runBundle.review ? [bundle.runBundle.review] : [],
      improvements,
      selectedNodeId: `loop:${bundle.loop.id}`,
      sourceLabel: "Demo catalog"
    })
  };
}
