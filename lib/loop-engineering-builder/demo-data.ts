import { demoLoopBundle, generateManagementReview } from "./agent";
import { generateLoopQuestions, questionProgress } from "./demo-helpers";
import { buildLoopGraph } from "./graph";
import { getDepartmentTemplates } from "./templates";
import type { ImprovementItem, LoopRecord, WorkspaceData } from "./types";

export function getDemoWorkspace(): WorkspaceData {
  const bundle = demoLoopBundle();
  const loops = createDemoLoops(bundle.loop);
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
    }
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
      selectedNodeId: `loop:${bundle.loop.id}`
    })
  };
}

function createDemoLoops(primaryLoop: LoopRecord): LoopRecord[] {
  const common: Pick<
    LoopRecord,
    "organizationId" | "status" | "autonomyLevel" | "owner" | "cadence" | "specGenerated" | "implementationGenerated"
  > = {
    organizationId: primaryLoop.organizationId,
    status: "active",
    autonomyLevel: "draft_for_review",
    owner: "Department owner",
    cadence: "Weekly",
    specGenerated: true,
    implementationGenerated: true
  };

  return [
    primaryLoop,
    demoLoop("loop_demo_sales_pipeline", "sales", "sales-follow_up", "Sales Pipeline Learning", "follow_up", "Follow-up latency", "More substantive buyer conversations", 0, 1),
    demoLoop("loop_demo_product_discovery", "product", "product-feedback_to_problem", "Product Discovery Loop", "feedback_to_problem", "Feedback-to-problem time", "Recurring pain becomes better product bets", 0, 1),
    demoLoop("loop_demo_customer_health", "customer_success", "customer_success-customer_health_risk", "Customer Success Health Loop", "customer_health_risk", "Churn risk reduction", "At-risk accounts get timely human attention", 1, 1),
    demoLoop("loop_demo_engineering_quality", "engineering", "engineering-qa_checklist", "Engineering Quality Loop", "qa_checklist", "Escaped defects", "Quality checks move earlier in delivery", 0, 1),
    demoLoop("loop_demo_ops_efficiency", "operations_finance", "operations_finance-approval_bottleneck", "Ops / Finance Efficiency Loop", "approval_bottleneck", "Approval latency", "Bottlenecks route to accountable owners", 0, 1),
    demoLoop("loop_demo_people_engagement", "hr", "hr-manager_coaching", "People Ops Engagement Loop", "manager_coaching", "Coaching hours", "Managers get better recurring team signals", 0, 0),
    demoLoop("loop_demo_risk_compliance", "legal_security", "legal_security-policy_drift", "Risk & Compliance Loop", "policy_drift", "Audit readiness", "Policy drift becomes reviewable evidence", 0, 1)
  ];

  function demoLoop(
    id: string,
    department: LoopRecord["department"],
    templateId: string,
    name: string,
    loopType: string,
    targetMetric: string,
    businessOutcome: string,
    openReviews: number,
    improvementItems: number
  ): LoopRecord {
    return {
      ...common,
      id,
      templateId,
      name,
      department,
      loopType,
      goal: `${name} improves ${targetMetric.toLowerCase()} while keeping human judgment explicit.`,
      targetMetric,
      businessOutcome,
      lastRunAt: "2026-06-22T17:00:00.000Z",
      openReviews,
      improvementItems
    };
  }
}
