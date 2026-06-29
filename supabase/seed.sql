insert into loop_templates (department, loop_type, name, description, template, is_builtin)
values
  (
    'marketing',
    'campaign_learning',
    'Campaign Learning Loop',
    'Observe funnel and cohort quality, generate experiment hypotheses, verify against downstream metrics, and feed learning into a reusable message and channel library.',
    '{
      "goal": "Acquire qualified customers at a sustainable CAC while increasing the speed and quality of marketing learning.",
      "businessOutcome": "More qualified activated or paying customers from channels that can scale without degrading cohort quality.",
      "primaryMetric": "Cost per qualified customer",
      "secondaryMetrics": ["Qualified conversion rate", "CAC payback", "Activation rate", "Retention of acquired cohort", "Experiment learning velocity"],
      "observes": ["Ad spend", "Impressions", "Clicks", "Landing page visits", "Leads", "Qualified leads", "Activated users", "Paying customers", "Channel source", "Campaign", "Audience", "Creative", "Landing page", "Sales feedback", "Customer quality", "Retention"],
      "requiredDataSources": ["Ad platforms", "Analytics", "CRM", "Payment/subscription system", "Product analytics", "Landing page/form data", "Sales notes", "Customer success notes"],
      "routine": ["Pull channel and funnel data", "Identify the current funnel constraint", "Generate experiment hypotheses against that constraint", "Prioritize experiments by expected impact, confidence, cost, and speed", "Draft creative/copy/landing-page change", "Route risky or brand-sensitive assets to human review", "Launch approved tests", "Monitor results", "Compare against value metric, not only proxy metrics", "Kill, continue, or scale", "Save learning into message/ICP/channel library", "Feed weekly summary into management loop"],
      "verification": ["Does this test target the current constraint?", "Is the ICP clear?", "Is the claim accurate?", "Is brand voice acceptable?", "Is attribution trustworthy?", "Is sample size enough to make a decision?", "Did the test improve downstream quality or only upstream proxy metrics?"],
      "escalation": ["Spend increase exceeds threshold", "Creative makes factual/performance claims", "Legal/compliance-sensitive claims are included", "CAC improves but activation/retention worsens", "The loop recommends killing a strategic channel", "Data is inconsistent or attribution is unclear"]
    }'::jsonb,
    true
  ),
  ('marketing', 'channel_allocation', 'Channel Allocation Loop', 'Shift budget toward channels with the strongest qualified downstream outcomes.', '{}'::jsonb, true),
  ('marketing', 'creative_testing', 'Creative Testing Loop', 'Generate, review, launch, and learn from creative variants.', '{}'::jsonb, true),
  ('marketing', 'landing_page_conversion', 'Landing Page Conversion Loop', 'Improve landing page performance while preserving customer quality.', '{}'::jsonb, true),
  ('marketing', 'icp_messaging_learning', 'ICP / Messaging Learning Loop', 'Turn sales and customer feedback into sharper audience and message hypotheses.', '{}'::jsonb, true),
  ('product', 'feedback_to_problem', 'Feedback to Problem Loop', 'Cluster feedback and convert repeated pain into well-formed product problems.', '{}'::jsonb, true),
  ('product', 'problem_to_product_bet', 'Problem to Product Bet Loop', 'Turn a validated problem into a scoped product bet.', '{}'::jsonb, true),
  ('product', 'release_learning', 'Release Learning Loop', 'Compare shipped releases against adoption and customer outcome signals.', '{}'::jsonb, true),
  ('product', 'bug_cluster_to_problem', 'Bug Cluster to Product Problem Loop', 'Detect repeated bugs that point to deeper product or UX problems.', '{}'::jsonb, true),
  ('customer_success', 'customer_health_risk', 'Customer Health Risk Loop', 'Detect risk from usage, sentiment, tickets, and renewal context.', '{}'::jsonb, true),
  ('customer_success', 'support_triage', 'Support Triage Loop', 'Classify, route, and draft support responses with human escalation.', '{}'::jsonb, true),
  ('customer_success', 'renewal_risk', 'Renewal Risk Loop', 'Surface renewal risk early and generate account intervention plans.', '{}'::jsonb, true),
  ('customer_success', 'proactive_outreach', 'Proactive Outreach Loop', 'Identify moments where proactive human outreach matters.', '{}'::jsonb, true),
  ('sales', 'lead_qualification', 'Lead Qualification Loop', 'Score and route leads using fit, intent, and readiness signals.', '{}'::jsonb, true),
  ('sales', 'account_research', 'Account Research Loop', 'Prepare concise account context and likely buying triggers.', '{}'::jsonb, true),
  ('sales', 'follow_up', 'Follow-up Loop', 'Keep next steps moving after meetings without losing personalization.', '{}'::jsonb, true),
  ('sales', 'crm_hygiene', 'CRM Hygiene Loop', 'Detect stale opportunities and missing fields.', '{}'::jsonb, true),
  ('engineering', 'issue_to_plan', 'Issue to Implementation Plan Loop', 'Turn accepted issues into scoped implementation plans.', '{}'::jsonb, true),
  ('engineering', 'pr_review_prep', 'PR Review Prep Loop', 'Summarize risk, tests, and reviewer context before review.', '{}'::jsonb, true),
  ('engineering', 'qa_checklist', 'QA Checklist Loop', 'Generate release-specific QA checks and trace outcomes.', '{}'::jsonb, true),
  ('engineering', 'incident_learning', 'Incident Learning Loop', 'Convert incidents into root-cause learning and prevention items.', '{}'::jsonb, true),
  ('management', 'weekly_anomaly_review', 'Weekly Anomaly Review Loop', 'Detect important company metric drift and prepare decisions.', '{}'::jsonb, true),
  ('management', 'department_loop_review', 'Department Loop Review', 'Roll up loop health, bottlenecks, reviews, and improvement work.', '{}'::jsonb, true),
  ('management', 'decision_memo', 'Decision Memo Loop', 'Turn ambiguous signals into decision options with tradeoffs.', '{}'::jsonb, true),
  ('management', 'resource_allocation', 'Resource Allocation Loop', 'Match goals, bottlenecks, capacity, and constraints.', '{}'::jsonb, true),
  ('management', 'improvement', 'Improvement Loop', 'Convert loop failures and human corrections into system changes.', '{}'::jsonb, true);

-- Optional Design Studio workspace seed (org + starter loop)
insert into organizations (name)
select 'Acme Loops'
where not exists (select 1 from organizations where name = 'Acme Loops');

insert into loops (
  organization_id,
  template_id,
  name,
  department,
  loop_type,
  status,
  autonomy_level,
  goal,
  target_metric,
  business_outcome,
  cadence
)
select
  org.id,
  tmpl.id,
  'Campaign Learning Loop',
  'marketing',
  'campaign_learning',
  'active',
  'draft_for_review',
  'Acquire qualified customers at a sustainable CAC.',
  'Cost per qualified customer',
  'More qualified activated customers from scalable channels.',
  'Weekly'
from organizations org
cross join loop_templates tmpl
where org.name = 'Acme Loops'
  and tmpl.department = 'marketing'
  and tmpl.loop_type = 'campaign_learning'
  and not exists (
    select 1 from loops where organization_id = org.id and name = 'Campaign Learning Loop'
  );
