import { Readable, Writable } from "node:stream";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  evidenceGapSetSchema,
  eventEnvelopeSchema,
  graphChangeApprovalReceiptSchema,
  graphChangeSetSchema,
  graphSnapshotSchema,
  graphTransactionSchema,
  hermesDesignTaskSchema,
  hermesAgentInstanceSchema,
  hermesExecutionEventSchema,
  COMPANY_LOOP_LIBRARY_SCHEMA_VERSION,
  CROSS_DEPARTMENT_PLAYBOOKS,
  DEPARTMENT_OPERATING_SKILLS,
  HERMES_ROUTER_EVALUATION_QUESTIONS,
  PREBUILT_COMPANY_LOOPS,
  getDepartmentOperatingSkill,
  listDepartmentCatalog,
  loopPromotionReceiptSchema,
  metricBindingSchema,
  measurementJobSchema,
  connectionReconciliationReportSchema,
  promotionRehearsalReportSchema,
  metricSampleSchema,
  observedOutcomeSchema,
  loopOpportunitySchema,
  loopControllerPolicySchema,
  loopControllerRunSchema,
  loopDesignContextSchema,
  loopDesignProposalSetSchema,
  requireDepartmentType,
  routingCardSchema,
  routingDecisionSchema,
  valueLedgerEntrySchema
} from "../core";
import {
  callLoopgraphRoutingTool,
  eventsReplayInputSchema,
  loopgraphRoutingToolDefinitions,
  routeCommitSimulateInputSchema,
  routingCatalogGetInputSchema,
  eventsIngestInputSchema,
  routingDecisionSubmitInputSchema,
  routingHumanChoiceSubmitInputSchema,
  type LoopgraphRoutingToolName
} from "../runtime/routing-tools";
import {
  callLoopgraphRoutingOpsTool,
  eventsGetInputSchema,
  graphGetInputSchema,
  lifecycleEventsGetInputSchema,
  loopgraphRoutingOpsToolDefinitions,
  problemsGetInputSchema,
  routeJobsGetInputSchema,
  routingEvaluationsGetInputSchema,
  routingDecisionGetInputSchema,
  type LoopgraphRoutingOpsToolName
} from "../runtime/routing-ops-tools";
import {
  callLoopgraphRoutingEvaluationTool,
  loopgraphRoutingEvaluationToolDefinitions,
  routingEvaluationRunInputSchema,
  type LoopgraphRoutingEvaluationToolName
} from "../runtime/routing-evaluation-tools";
import {
  callLoopgraphHermesWebhookTool,
  hermesWebhookFixtureTestInputSchema,
  hermesWebhooksDoctorInputSchema,
  hermesWebhooksPlanInputSchema,
  hermesWebhooksSyncInputSchema,
  loopgraphHermesWebhookToolDefinitions,
  type LoopgraphHermesWebhookToolName
} from "../runtime/hermes-webhooks";
import {
  agentOperationsGetInputSchema,
  callLoopgraphHermesOperationsTool,
  hermesAgentHeartbeatInputSchema,
  hermesAgentRegisterInputSchema,
  hermesExecutionEventIngestInputSchema,
  loopgraphHermesOperationsToolDefinitions,
  type LoopgraphHermesOperationsToolName
} from "../runtime/hermes-operations-tools";
import {
  callLoopgraphWorkspaceTool,
  departmentsListInputSchema,
  loopgraphWorkspaceToolDefinitions,
  workspaceInspectInputSchema,
  type LoopgraphWorkspaceToolName
} from "../runtime/workspace-tools";
import {
  callLoopgraphDiscoveryTool,
  discoveryConfirmProjectContextInputSchema,
  discoveryGetInputSchema,
  discoveryNextQuestionsInputSchema,
  discoverySelectDepartmentsInputSchema,
  discoveryStartInputSchema,
  discoverySubmitAnswersInputSchema,
  loopgraphDiscoveryToolDefinitions,
  type LoopgraphDiscoveryToolName
} from "../runtime/discovery-tools";
import {
  getDiscoverySession,
  listHermesDiscoverySessions
} from "../runtime/discovery-session";
import {
  callLoopgraphDesignTool,
  designContextGetInputSchema,
  designEditInputSchema,
  designGenerateInputSchema,
  designSubmitInputSchema,
  loopgraphDesignToolDefinitions,
  type LoopgraphDesignToolName
} from "../runtime/design-tools";
import {
  callLoopgraphHermesDesignTool,
  evidenceGapAnswerInputSchema,
  evidenceGapsGetInputSchema,
  hermesDesignStartInputSchema,
  hermesDesignTasksGetInputSchema,
  loopgraphHermesDesignToolDefinitions,
  type LoopgraphHermesDesignToolName
} from "../runtime/hermes-design-tools";
import {
  callLoopgraphOpportunityTool,
  graphChangesGetInputSchema,
  loopgraphOpportunityToolDefinitions,
  opportunitiesGetInputSchema,
  opportunitiesScanInputSchema,
  opportunityDismissInputSchema,
  type LoopgraphOpportunityToolName
} from "../runtime/loop-opportunity-tools";
import {
  callLoopgraphRouteJobWorkerTool,
  loopgraphRouteJobWorkerToolDefinitions,
  routeJobCancelInputSchema,
  routeJobRetryInputSchema,
  routeWorkerRunInputSchema,
  type LoopgraphRouteJobWorkerToolName
} from "../runtime/route-job-worker-tools";
import {
  callLoopgraphOutcomeTool,
  loopgraphOutcomeToolDefinitions,
  metricSampleIngestInputSchema,
  metricSamplesGetInputSchema,
  outcomesEvaluateInputSchema,
  outcomesGetInputSchema,
  valueLedgerGetInputSchema,
  valueLedgerRecordInputSchema,
  type LoopgraphOutcomeToolName
} from "../runtime/outcome-tools";
import {
  callLoopgraphControllerTool,
  controllerPolicyGetInputSchema,
  controllerPolicySetInputSchema,
  controllerRunInputSchema,
  controllerRunsGetInputSchema,
  loopgraphControllerToolDefinitions,
  type LoopgraphControllerToolName
} from "../runtime/loop-controller-tools";
import {
  callLoopgraphLoopTool,
  loopgraphLoopToolDefinitions,
  loopsListInputSchema,
  loopsMaterializeInputSchema,
  loopsSimulateInputSchema,
  loopsValidateInputSchema,
  runsGetInputSchema,
  caseResolveInputSchema,
  reviewSubmitInputSchema,
  type LoopgraphLoopToolName
} from "../runtime/loop-tools";
import { listLoopgraphLoops } from "../runtime/loop-materialization";
import {
  appActivationApproveInputSchema,
  appActivateInputSchema,
  companyBlueprintGetInputSchema,
  companyBlueprintsSearchInputSchema,
  companyContextApproveInputSchema,
  companyContextGetInputSchema,
  departmentPackGetInputSchema,
  departmentPacksSearchInputSchema,
  appGetInputSchema,
  appOnboardingGetInputSchema,
  appHistoricalReplayInputSchema,
  appEvaluationLabelInputSchema,
  appConfigureInputSchema,
  appOverlayApplyInputSchema,
  appRepairInputSchema,
  appDuplicateInputSchema,
  appDiffInputSchema,
  appUpdatePlanInputSchema,
  appUpdateApplyInputSchema,
  appRollbackInputSchema,
  appDetachInputSchema,
  appUninstallInputSchema,
  appPromotionRecommendationInputSchema,
  appInstallApplyInputSchema,
  appInstallPlanInputSchema,
  appInstallStatusInputSchema,
  appOperationResolveInputSchema,
  appOperationInvokeInputSchema,
  appOperationActionsGetInputSchema,
  appMaturityGetInputSchema,
  appVerificationRegistryGetInputSchema,
  appVerifierTrustAddInputSchema,
  appVerifierTrustRevokeInputSchema,
  appVerificationImportInputSchema,
  connectorSchemaRecordInputSchema,
  appFieldMappingsGetInputSchema,
  appFieldMappingConfirmInputSchema,
  appPauseInputSchema,
  appResumeInputSchema,
  appTestInputSchema,
  appPublisherKeyGenerateInputSchema,
  appPublisherKeysGetInputSchema,
  appInitInputSchema,
  appCaptureInputSchema,
  appDevInputSchema,
  appPreviewInputSchema,
  appValidateInputSchema,
  appPackInputSchema,
  appSignInputSchema,
  appPublishInputSchema,
  appReleaseStatusInputSchema,
  marketplaceSourcesGetInputSchema,
  marketplaceSourceAddInputSchema,
  marketplaceSourceRefreshInputSchema,
  callLoopgraphAppTool,
  loopgraphAppToolDefinitions,
  marketplaceSearchInputSchema,
  type LoopgraphAppToolName
} from "../runtime/app-tools";
import {
  callLoopgraphProjectTool,
  loopgraphProjectToolDefinitions,
  projectInspectInputSchema,
  type LoopgraphProjectToolName
} from "../runtime/project-tools";
import {
  callLoopgraphConnectionTool,
  connectionsGetInputSchema,
  connectionsHealthReportInputSchema,
  connectionsPlanInputSchema,
  connectionsRegisterInputSchema,
  connectionsSetManualFallbackInputSchema,
  loopgraphConnectionToolDefinitions,
  type LoopgraphConnectionToolName
} from "../runtime/connection-tools";
import {
  callLoopgraphMeasurementTool,
  connectionReconciliationsGetInputSchema,
  connectionsReconcileInputSchema,
  loopgraphMeasurementToolDefinitions,
  measurementJobsClaimInputSchema,
  measurementJobsCompleteInputSchema,
  measurementJobsFailInputSchema,
  measurementJobsGetInputSchema,
  measurementsScheduleInputSchema,
  metricBindingsGetInputSchema,
  metricBindingsSetInputSchema,
  type LoopgraphMeasurementToolName
} from "../runtime/measurement-tools";
import {
  callLoopgraphProviderTool,
  loopgraphProviderToolDefinitions,
  providerCatalogGetInputSchema,
  providerEventNormalizeInputSchema,
  providerInstallPrepareInputSchema,
  type LoopgraphProviderToolName
} from "../runtime/provider-tools";
import {
  callLoopgraphSemanticGraphTool,
  graphChangeApplyInputSchema,
  graphChangeDecideInputSchema,
  graphHistoryGetInputSchema,
  graphRollbackApproveInputSchema,
  graphRollbackInputSchema,
  loopgraphSemanticGraphToolDefinitions,
  loopLifecycleApproveInputSchema,
  loopLifecycleSetInputSchema,
  loopPromoteInputSchema,
  loopPromotionApproveInputSchema,
  promotionRehearsalRunInputSchema,
  promotionRehearsalsGetInputSchema,
  type LoopgraphSemanticGraphToolName
} from "../runtime/semantic-graph-tools";
import { loadLoopSpecFromPath } from "../runtime/loader";

const LATEST_MCP_PROTOCOL_VERSION = "2025-11-25";
export const DEFAULT_LOOPGRAPH_MCP_MAX_LINE_BYTES = 1024 * 1024;
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  LATEST_MCP_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26"
]);

type JsonRpcId = string | number;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type LoopgraphMcpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: "application/json";
};

export type LoopgraphMcpExposure = "admin" | "webhook_router" | "lifecycle_router";

export type LoopgraphMcpServerOptions = {
  projectRoot?: string;
  now?: Date;
  exposure?: LoopgraphMcpExposure;
};

type LoopgraphMcpToolName =
  | LoopgraphRoutingToolName
  | LoopgraphRoutingOpsToolName
  | LoopgraphRoutingEvaluationToolName
  | LoopgraphHermesWebhookToolName
  | LoopgraphHermesOperationsToolName
  | LoopgraphWorkspaceToolName
  | LoopgraphDiscoveryToolName
  | LoopgraphProjectToolName
  | LoopgraphDesignToolName
  | LoopgraphHermesDesignToolName
  | LoopgraphOpportunityToolName
  | LoopgraphRouteJobWorkerToolName
  | LoopgraphOutcomeToolName
  | LoopgraphControllerToolName
  | LoopgraphSemanticGraphToolName
  | LoopgraphConnectionToolName
  | LoopgraphMeasurementToolName
  | LoopgraphProviderToolName
  | LoopgraphLoopToolName
  | LoopgraphAppToolName;

const toolInputSchemas = {
  loopgraph_workspace_inspect: workspaceInspectInputSchema,
  loopgraph_departments_list: departmentsListInputSchema,
  loopgraph_discovery_start: discoveryStartInputSchema,
  loopgraph_discovery_get: discoveryGetInputSchema,
  loopgraph_discovery_confirm_project_context: discoveryConfirmProjectContextInputSchema,
  loopgraph_discovery_select_departments: discoverySelectDepartmentsInputSchema,
  loopgraph_discovery_next_questions: discoveryNextQuestionsInputSchema,
  loopgraph_discovery_submit_answers: discoverySubmitAnswersInputSchema,
  loopgraph_project_inspect: projectInspectInputSchema,
  loopgraph_design_context_get: designContextGetInputSchema,
  loopgraph_design_generate: designGenerateInputSchema,
  loopgraph_design_submit: designSubmitInputSchema,
  loopgraph_design_edit: designEditInputSchema,
  loopgraph_hermes_design_start: hermesDesignStartInputSchema,
  loopgraph_hermes_design_tasks_get: hermesDesignTasksGetInputSchema,
  loopgraph_evidence_gaps_get: evidenceGapsGetInputSchema,
  loopgraph_evidence_gap_answer: evidenceGapAnswerInputSchema,
  loopgraph_opportunities_scan: opportunitiesScanInputSchema,
  loopgraph_opportunities_get: opportunitiesGetInputSchema,
  loopgraph_opportunity_dismiss: opportunityDismissInputSchema,
  loopgraph_graph_changes_get: graphChangesGetInputSchema,
  loopgraph_route_worker_run: routeWorkerRunInputSchema,
  loopgraph_route_job_retry: routeJobRetryInputSchema,
  loopgraph_route_job_cancel: routeJobCancelInputSchema,
  loopgraph_metric_samples_ingest: metricSampleIngestInputSchema,
  loopgraph_metric_samples_get: metricSamplesGetInputSchema,
  loopgraph_outcomes_evaluate: outcomesEvaluateInputSchema,
  loopgraph_outcomes_get: outcomesGetInputSchema,
  loopgraph_value_ledger_record: valueLedgerRecordInputSchema,
  loopgraph_value_ledger_get: valueLedgerGetInputSchema,
  loopgraph_controller_run: controllerRunInputSchema,
  loopgraph_controller_runs_get: controllerRunsGetInputSchema,
  loopgraph_controller_policy_get: controllerPolicyGetInputSchema,
  loopgraph_controller_policy_set: controllerPolicySetInputSchema,
  loopgraph_graph_change_decide: graphChangeDecideInputSchema,
  loopgraph_graph_change_apply: graphChangeApplyInputSchema,
  loopgraph_graph_history_get: graphHistoryGetInputSchema,
  loopgraph_promotion_rehearsal_run: promotionRehearsalRunInputSchema,
  loopgraph_promotion_rehearsals_get: promotionRehearsalsGetInputSchema,
  loopgraph_loop_promotion_approve: loopPromotionApproveInputSchema,
  loopgraph_loop_promote: loopPromoteInputSchema,
  loopgraph_loop_lifecycle_approve: loopLifecycleApproveInputSchema,
  loopgraph_loop_lifecycle_set: loopLifecycleSetInputSchema,
  loopgraph_graph_rollback_approve: graphRollbackApproveInputSchema,
  loopgraph_graph_rollback: graphRollbackInputSchema,
  loopgraph_connections_plan: connectionsPlanInputSchema,
  loopgraph_connections_set_manual_fallback: connectionsSetManualFallbackInputSchema,
  loopgraph_connections_register: connectionsRegisterInputSchema,
  loopgraph_connections_health_report: connectionsHealthReportInputSchema,
  loopgraph_connections_get: connectionsGetInputSchema,
  loopgraph_metric_bindings_set: metricBindingsSetInputSchema,
  loopgraph_metric_bindings_get: metricBindingsGetInputSchema,
  loopgraph_measurements_schedule: measurementsScheduleInputSchema,
  loopgraph_measurement_jobs_claim: measurementJobsClaimInputSchema,
  loopgraph_measurement_jobs_complete: measurementJobsCompleteInputSchema,
  loopgraph_measurement_jobs_fail: measurementJobsFailInputSchema,
  loopgraph_measurement_jobs_get: measurementJobsGetInputSchema,
  loopgraph_connections_reconcile: connectionsReconcileInputSchema,
  loopgraph_connections_reconciliations_get: connectionReconciliationsGetInputSchema,
  loopgraph_provider_catalog_get: providerCatalogGetInputSchema,
  loopgraph_provider_install_prepare: providerInstallPrepareInputSchema,
  loopgraph_provider_event_normalize: providerEventNormalizeInputSchema,
  loopgraph_loops_list: loopsListInputSchema,
  loopgraph_runs_get: runsGetInputSchema,
  loopgraph_loops_materialize: loopsMaterializeInputSchema,
  loopgraph_loops_validate: loopsValidateInputSchema,
  loopgraph_loops_simulate: loopsSimulateInputSchema,
  loopgraph_review_submit: reviewSubmitInputSchema,
  loopgraph_case_resolve: caseResolveInputSchema,
  loopgraph_routing_catalog_get: routingCatalogGetInputSchema,
  loopgraph_events_ingest: eventsIngestInputSchema,
  loopgraph_events_replay: eventsReplayInputSchema,
  loopgraph_routing_decision_submit: routingDecisionSubmitInputSchema,
  loopgraph_routing_human_choice_submit: routingHumanChoiceSubmitInputSchema,
  loopgraph_route_commit_simulate: routeCommitSimulateInputSchema,
  loopgraph_events_get: eventsGetInputSchema,
  loopgraph_problems_get: problemsGetInputSchema,
  loopgraph_routing_decision_get: routingDecisionGetInputSchema,
  loopgraph_route_jobs_get: routeJobsGetInputSchema,
  loopgraph_routing_evaluations_get: routingEvaluationsGetInputSchema,
  loopgraph_lifecycle_events_get: lifecycleEventsGetInputSchema,
  loopgraph_graph_get: graphGetInputSchema,
  loopgraph_routing_evaluation_run: routingEvaluationRunInputSchema,
  loopgraph_hermes_webhooks_plan: hermesWebhooksPlanInputSchema,
  loopgraph_hermes_webhooks_sync: hermesWebhooksSyncInputSchema,
  loopgraph_hermes_webhooks_doctor: hermesWebhooksDoctorInputSchema,
  loopgraph_hermes_webhooks_test: hermesWebhookFixtureTestInputSchema,
  loopgraph_hermes_agent_register: hermesAgentRegisterInputSchema,
  loopgraph_hermes_agent_heartbeat: hermesAgentHeartbeatInputSchema,
  loopgraph_hermes_execution_event_ingest: hermesExecutionEventIngestInputSchema,
  loopgraph_agent_operations_get: agentOperationsGetInputSchema,
  loopgraph_company_blueprints_search: companyBlueprintsSearchInputSchema,
  loopgraph_company_blueprint_get: companyBlueprintGetInputSchema,
  loopgraph_company_context_get: companyContextGetInputSchema,
  loopgraph_company_context_approve: companyContextApproveInputSchema,
  loopgraph_department_packs_search: departmentPacksSearchInputSchema,
  loopgraph_department_pack_get: departmentPackGetInputSchema,
  loopgraph_marketplace_search: marketplaceSearchInputSchema,
  loopgraph_app_get: appGetInputSchema,
  loopgraph_app_onboarding_get: appOnboardingGetInputSchema,
  loopgraph_app_install_plan: appInstallPlanInputSchema,
  loopgraph_app_install_apply: appInstallApplyInputSchema,
  loopgraph_app_install_status: appInstallStatusInputSchema,
  loopgraph_app_operation_resolve: appOperationResolveInputSchema,
  loopgraph_app_operation_invoke: appOperationInvokeInputSchema,
  loopgraph_app_operation_actions_get: appOperationActionsGetInputSchema,
  loopgraph_app_maturity_get: appMaturityGetInputSchema,
  loopgraph_app_verification_registry_get: appVerificationRegistryGetInputSchema,
  loopgraph_app_verifier_trust_add: appVerifierTrustAddInputSchema,
  loopgraph_app_verifier_trust_revoke: appVerifierTrustRevokeInputSchema,
  loopgraph_app_verification_import: appVerificationImportInputSchema,
  loopgraph_connector_schema_record: connectorSchemaRecordInputSchema,
  loopgraph_app_field_mappings_get: appFieldMappingsGetInputSchema,
  loopgraph_app_field_mapping_confirm: appFieldMappingConfirmInputSchema,
  loopgraph_app_test: appTestInputSchema,
  loopgraph_app_historical_replay: appHistoricalReplayInputSchema,
  loopgraph_app_evaluation_label: appEvaluationLabelInputSchema,
  loopgraph_app_promotion_recommendation: appPromotionRecommendationInputSchema,
  loopgraph_app_configure: appConfigureInputSchema,
  loopgraph_app_overlay_apply: appOverlayApplyInputSchema,
  loopgraph_app_repair: appRepairInputSchema,
  loopgraph_app_duplicate: appDuplicateInputSchema,
  loopgraph_app_diff: appDiffInputSchema,
  loopgraph_app_update_plan: appUpdatePlanInputSchema,
  loopgraph_app_update_apply: appUpdateApplyInputSchema,
  loopgraph_app_rollback: appRollbackInputSchema,
  loopgraph_app_detach: appDetachInputSchema,
  loopgraph_app_uninstall: appUninstallInputSchema,
  loopgraph_app_activation_approve: appActivationApproveInputSchema,
  loopgraph_app_activate: appActivateInputSchema,
  loopgraph_app_pause: appPauseInputSchema,
  loopgraph_app_resume: appResumeInputSchema,
  loopgraph_app_publisher_key_generate: appPublisherKeyGenerateInputSchema,
  loopgraph_app_publisher_keys_get: appPublisherKeysGetInputSchema,
  loopgraph_app_init: appInitInputSchema,
  loopgraph_app_capture: appCaptureInputSchema,
  loopgraph_app_dev: appDevInputSchema,
  loopgraph_app_preview: appPreviewInputSchema,
  loopgraph_app_validate: appValidateInputSchema,
  loopgraph_app_pack: appPackInputSchema,
  loopgraph_app_sign: appSignInputSchema,
  loopgraph_app_publish: appPublishInputSchema,
  loopgraph_app_release_status: appReleaseStatusInputSchema,
  loopgraph_marketplace_sources_get: marketplaceSourcesGetInputSchema,
  loopgraph_marketplace_source_add: marketplaceSourceAddInputSchema,
  loopgraph_marketplace_source_refresh: marketplaceSourceRefreshInputSchema
};

const loopgraphMcpToolDefinitions = [
  ...loopgraphWorkspaceToolDefinitions,
  ...loopgraphDiscoveryToolDefinitions,
  ...loopgraphProjectToolDefinitions,
  ...loopgraphDesignToolDefinitions,
  ...loopgraphHermesDesignToolDefinitions,
  ...loopgraphOpportunityToolDefinitions,
  ...loopgraphRouteJobWorkerToolDefinitions,
  ...loopgraphOutcomeToolDefinitions,
  ...loopgraphControllerToolDefinitions,
  ...loopgraphSemanticGraphToolDefinitions,
  ...loopgraphConnectionToolDefinitions,
  ...loopgraphMeasurementToolDefinitions,
  ...loopgraphProviderToolDefinitions,
  ...loopgraphLoopToolDefinitions,
  ...loopgraphRoutingToolDefinitions,
  ...loopgraphRoutingOpsToolDefinitions,
  ...loopgraphRoutingEvaluationToolDefinitions,
  ...loopgraphHermesWebhookToolDefinitions,
  ...loopgraphHermesOperationsToolDefinitions,
  ...loopgraphAppToolDefinitions
] as const;

export const LOOPGRAPH_WEBHOOK_ROUTER_MCP_TOOL_NAMES = [
  "loopgraph_routing_catalog_get",
  "loopgraph_events_ingest",
  "loopgraph_routing_decision_submit",
  "loopgraph_events_get",
  "loopgraph_problems_get",
  "loopgraph_routing_decision_get",
  "loopgraph_graph_get"
] as const satisfies readonly LoopgraphMcpToolName[];

export const LOOPGRAPH_LIFECYCLE_ROUTER_MCP_TOOL_NAMES = [
  "loopgraph_events_ingest",
  "loopgraph_events_get",
  "loopgraph_graph_get"
] as const satisfies readonly LoopgraphMcpToolName[];

export const LOOPGRAPH_MCP_STATIC_RESOURCE_URIS = [
  "loopgraph://schemas/loop-design-context",
  "loopgraph://schemas/loop-design-proposal-set",
  "loopgraph://schemas/event-envelope",
  "loopgraph://schemas/routing-card",
  "loopgraph://schemas/routing-decision",
  "loopgraph://schemas/evidence-gap-set",
  "loopgraph://schemas/hermes-design-task",
  "loopgraph://schemas/loop-opportunity",
  "loopgraph://schemas/graph-change-set",
  "loopgraph://schemas/metric-sample",
  "loopgraph://schemas/observed-outcome",
  "loopgraph://schemas/value-ledger-entry",
  "loopgraph://schemas/loop-controller-policy",
  "loopgraph://schemas/loop-controller-run",
  "loopgraph://schemas/graph-snapshot",
  "loopgraph://schemas/graph-change-approval-receipt",
  "loopgraph://schemas/graph-transaction",
  "loopgraph://schemas/loop-promotion-receipt",
  "loopgraph://schemas/promotion-rehearsal",
  "loopgraph://schemas/metric-binding",
  "loopgraph://schemas/measurement-job",
  "loopgraph://schemas/connection-reconciliation",
  "loopgraph://schemas/hermes-agent-instance",
  "loopgraph://schemas/hermes-execution-event",
  "loopgraph://graph/company",
  "loopgraph://catalog/company-loops"
] as const;

const LOOPGRAPH_ROUTER_SCHEMA_RESOURCE_URIS = new Set([
  "loopgraph://schemas/event-envelope",
  "loopgraph://schemas/routing-card",
  "loopgraph://schemas/routing-decision"
]);

export function normalizeLoopgraphMcpExposure(value: unknown): LoopgraphMcpExposure {
  if (value === undefined || value === null || value === "") return "admin";
  if (value === "admin" || value === "webhook_router" || value === "lifecycle_router") return value;
  throw new Error(`Unsupported Loopgraph MCP exposure: ${String(value)}`);
}

export function listLoopgraphMcpTools(options: Pick<LoopgraphMcpServerOptions, "exposure"> = {}) {
  const exposure = normalizeLoopgraphMcpExposure(options.exposure);
  return loopgraphMcpToolDefinitions
    .filter((tool) => isToolAllowedForExposure(tool.name, exposure))
    .map((tool) => ({
      name: tool.name,
      title: titleFromToolName(tool.name),
      description: tool.description,
      inputSchema: zodToJsonSchema(toolInputSchemas[tool.name], `${tool.name}_input`),
      annotations: {
        title: titleFromToolName(tool.name),
        readOnlyHint: isReadOnlyToolName(tool.name),
        destructiveHint: isDestructiveToolName(tool.name),
        idempotentHint: isIdempotentToolName(tool.name),
        openWorldHint: false
      }
    }));
}

export async function listLoopgraphMcpResources(
  options: LoopgraphMcpServerOptions = {}
): Promise<LoopgraphMcpResource[]> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const departmentResources = listDepartmentCatalog({ includeCustom: true }).map((department) => ({
    uri: `loopgraph://departments/${department.id}`,
    name: `${department.label} department`,
    description: department.description,
    mimeType: "application/json" as const
  }));
  const schemaResources: LoopgraphMcpResource[] = [
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[0],
      name: "LoopDesignContext schema",
      description: "Bounded model input schema Hermes uses for high-reasoning loop design.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[1],
      name: "LoopDesignProposalSet schema",
      description: "Structured proposal schema Hermes must submit back to Loopgraph for validation.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[2],
      name: "EventEnvelope schema",
      description: "Normalized event schema used by Hermes webhook, schedule, manual, and lifecycle events.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[3],
      name: "RoutingCard schema",
      description: "Bounded per-loop route eligibility card schema shown to Hermes during event routing.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[4],
      name: "RoutingDecision schema",
      description: "Schema-constrained decision Hermes submits after classifying a business event.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[5],
      name: "EvidenceGapSet schema",
      description: "Focused missing-evidence contract Loopgraph uses to drive adaptive Hermes questions.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[6],
      name: "HermesDesignTask schema",
      description: "Durable Loopgraph-initiated design task and delivery state exposed to trusted Hermes sessions.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[7],
      name: "LoopOpportunity schema",
      description: "Explainable, scored opportunity to create, improve, split, merge, or retire a business loop.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[8],
      name: "GraphChangeSet schema",
      description: "Versioned proposed changes to the company loop graph derived from observed evidence.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[9],
      name: "MetricSample schema",
      description: "Source-qualified observed, modeled, or incomplete metric evidence.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[10],
      name: "ObservedOutcome schema",
      description: "Versioned comparison between baseline and post-loop business measurements.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[11],
      name: "ValueLedgerEntry schema",
      description: "Net loop value after review, rework, supervision, escalation, and governance cost.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[12],
      name: "LoopControllerPolicy schema",
      description: "Project-local policy boundaries for continuous evidence evaluation and automatic shadow changes.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[13],
      name: "LoopControllerRun schema",
      description: "Durable controller trigger, evidence, decision, policy receipt, and error record.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[14],
      name: "GraphSnapshot schema",
      description: "Content-bound registered LoopSpecs and generated assets captured before and after graph mutation.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[15],
      name: "GraphChangeApprovalReceipt schema",
      description: "Accountable approval bound to an exact graph, operation set, policy, actor, and evidence.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[16],
      name: "GraphTransaction schema",
      description: "Atomic semantic graph change, promotion, lifecycle, or rollback transaction record.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[17],
      name: "LoopPromotionReceipt schema",
      description: "Evidence-bound receipt for one ordered loop activation-mode promotion.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[18],
      name: "PromotionRehearsal schema",
      description: "Content-bound simulation, routing, ambiguity, regression, and policy gate report required for promotion.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[19],
      name: "MetricBinding schema",
      description: "Exact contract between a LoopSpec metric and one scheduled Hermes connector query.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[20],
      name: "MeasurementJob schema",
      description: "Leased, idempotent provider measurement job with a durable evidence result.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[21],
      name: "ConnectionReconciliation schema",
      description: "Connector, scope, webhook, health, and overdue-measurement reconciliation report.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[22],
      name: "HermesAgentInstance schema",
      description: "Capability-bounded Hermes runtime registration and heartbeat contract.",
      mimeType: "application/json"
    },
    {
      uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[23],
      name: "HermesExecutionEvent schema",
      description: "Assignment-bound task, tool, approval, output, outcome, and run telemetry contract.",
      mimeType: "application/json"
    }
  ];
  const graphResources: LoopgraphMcpResource[] = [{
    uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[24],
    name: "Hermes Company Brain graph",
    description: "Project-bound design graph projection: Hermes Brain -> Department -> Loops.",
    mimeType: "application/json"
  }];
  const companyCatalogResources: LoopgraphMcpResource[] = [{
    uri: LOOPGRAPH_MCP_STATIC_RESOURCE_URIS[25],
    name: "Prebuilt company loop library",
    description: "Canonical department operating skills, Hermes routing questions, prebuilt loop claims, and shared-learning playbooks.",
    mimeType: "application/json"
  }];
  const exposure = normalizeLoopgraphMcpExposure(options.exposure);
  if (exposure !== "admin") {
    return [...schemaResources, ...graphResources]
      .filter((resource) => isResourceAllowedForExposure(resource.uri, exposure));
  }
  const sessions = await listHermesDiscoverySessions(projectRoot);
  const sessionResources = sessions.map((session) => ({
    uri: `loopgraph://discovery/${encodeURIComponent(session.id)}`,
    name: `Discovery session ${session.id}`,
    description: `Loopgraph discovery session for company ${session.companyId}.`,
    mimeType: "application/json" as const
  }));
  const loops = await listLoopgraphLoops({ projectRoot });
  const loopResources = loops.loops.map((loop) => ({
    uri: `loopgraph://loops/${encodeURIComponent(loop.loopId)}`,
    name: `${loop.name} loop`,
    description: `Registered ${loop.department} loop with ${loop.routingReady ? "ready" : "missing"} Hermes routing contract.`,
    mimeType: "application/json" as const
  }));

  return [
    ...schemaResources,
    ...departmentResources,
    ...sessionResources,
    ...loopResources,
    ...companyCatalogResources,
    ...graphResources
  ];
}

export async function handleLoopgraphMcpMessage(
  message: unknown,
  options: LoopgraphMcpServerOptions = {}
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return errorResponse(null, -32600, "Invalid Request", "Batch requests must not be empty");
    }
    const responses = (await Promise.all(message.map((item) => handleSingleMessage(item, options))))
      .filter((response): response is JsonRpcResponse => response !== null);
    return responses.length > 0 ? responses : null;
  }

  return handleSingleMessage(message, options);
}

export async function runLoopgraphMcpStdioServer(
  options: LoopgraphMcpServerOptions & {
    input?: Readable;
    output?: Writable;
    errorOutput?: Writable;
    maxLineBytes?: number;
  } = {}
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_LOOPGRAPH_MCP_MAX_LINE_BYTES;
  let buffer = "";
  let discardingOversizedLine = false;

  input.setEncoding("utf8");

  for await (const chunk of input) {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (discardingOversizedLine) {
        discardingOversizedLine = false;
      } else if (Buffer.byteLength(rawLine, "utf8") > maxLineBytes) {
        writeJsonLine(output, errorResponse(
          null,
          -32600,
          "Request too large",
          `MCP JSON line exceeds ${maxLineBytes} bytes`
        ));
      } else {
        const line = rawLine.trim();
        if (line.length > 0) {
          await handleLine(line, output, errorOutput, options);
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (!discardingOversizedLine && Buffer.byteLength(buffer, "utf8") > maxLineBytes) {
      writeJsonLine(output, errorResponse(
        null,
        -32600,
        "Request too large",
        `MCP JSON line exceeds ${maxLineBytes} bytes`
      ));
      buffer = "";
      discardingOversizedLine = true;
    }
  }

  const remaining = discardingOversizedLine ? "" : buffer.trim();
  if (remaining.length > 0 && Buffer.byteLength(remaining, "utf8") <= maxLineBytes) {
    await handleLine(remaining, output, errorOutput, options);
  } else if (remaining.length > 0) {
    writeJsonLine(output, errorResponse(
      null,
      -32600,
      "Request too large",
      `MCP JSON line exceeds ${maxLineBytes} bytes`
    ));
  }
}

async function handleLine(
  line: string,
  output: Writable,
  errorOutput: Writable,
  options: LoopgraphMcpServerOptions
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    writeJsonLine(output, errorResponse(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)));
    return;
  }

  try {
    const response = await handleLoopgraphMcpMessage(parsed, options);
    if (response !== null) writeJsonLine(output, response);
  } catch (error) {
    errorOutput.write(`${error instanceof Error ? error.message : String(error)}\n`);
    writeJsonLine(output, errorResponse(null, -32603, "Internal error"));
  }
}

async function handleSingleMessage(
  message: unknown,
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return errorResponse(requestId(message), -32600, "Invalid Request", "Expected a JSON-RPC 2.0 message");
  }

  if (typeof message.method !== "string") {
    return null;
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  if (!hasId) {
    return null;
  }

  const id = requestId(message);
  if (id === null) {
    return errorResponse(null, -32600, "Invalid Request", "Request id must be a string or number");
  }

  return handleRequest({ ...(message as JsonRpcRequest), id }, options);
}

async function handleRequest(
  request: JsonRpcRequest & { id: JsonRpcId },
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse> {
  if (request.method === "initialize") {
    const requestedProtocolVersion = isRecord(request.params) && typeof request.params.protocolVersion === "string"
      ? request.params.protocolVersion
      : undefined;

    return resultResponse(request.id, {
      protocolVersion: requestedProtocolVersion && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedProtocolVersion)
        ? requestedProtocolVersion
        : LATEST_MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false
        },
        resources: {
          subscribe: false,
          listChanged: false
        }
      },
      serverInfo: {
        name: "loopgraph",
        version: "0.2.0"
      },
      instructions: mcpInstructionsForExposure(normalizeLoopgraphMcpExposure(options.exposure))
    });
  }

  if (request.method === "ping") {
    return resultResponse(request.id, {});
  }

  if (request.method === "tools/list") {
    return resultResponse(request.id, {
      tools: listLoopgraphMcpTools(options)
    });
  }

  if (request.method === "resources/list") {
    return resultResponse(request.id, {
      resources: await listLoopgraphMcpResources(options)
    });
  }

  if (request.method === "resources/read") {
    return handleResourceRead(request, options);
  }

  if (request.method === "tools/call") {
    return handleToolCall(request, options);
  }

  return errorResponse(request.id, -32601, "Method not found", request.method);
}

async function handleResourceRead(
  request: JsonRpcRequest & { id: JsonRpcId },
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse> {
  const params = isRecord(request.params) ? request.params : {};
  if (typeof params.uri !== "string") {
    return errorResponse(request.id, -32602, "Invalid params", "resources/read requires a string uri");
  }

  try {
    const content = await readLoopgraphMcpResource(params.uri, options);
    return resultResponse(request.id, {
      contents: [{
        uri: params.uri,
        mimeType: "application/json",
        text: `${JSON.stringify(content, null, 2)}\n`
      }]
    });
  } catch (error) {
    return errorResponse(request.id, -32002, "Resource not found", error instanceof Error ? error.message : String(error));
  }
}

async function readLoopgraphMcpResource(
  uri: string,
  options: LoopgraphMcpServerOptions = {}
): Promise<unknown> {
  const exposure = normalizeLoopgraphMcpExposure(options.exposure);
  if (!isResourceAllowedForExposure(uri, exposure)) {
    throw new Error(`Loopgraph MCP resource is unavailable for ${exposure} exposure: ${uri}`);
  }
  const parsed = parseLoopgraphResourceUri(uri);
  const projectRoot = options.projectRoot ?? process.cwd();

  if (parsed.collection === "schemas") {
    return schemaResource(parsed.id);
  }

  if (parsed.collection === "departments") {
    const departmentType = requireDepartmentType(parsed.id);
    const department = listDepartmentCatalog({ includeCustom: true }).find((item) => item.id === departmentType);
    if (!department) throw new Error(`Department resource not found: ${parsed.id}`);
    return {
      schemaVersion: "department-resource/v1alpha2",
      department,
      operatingSkill: getDepartmentOperatingSkill(departmentType),
      prebuiltLoops: PREBUILT_COMPANY_LOOPS.filter((item) => item.departmentType === departmentType),
      sharedLearningPlaybooks: CROSS_DEPARTMENT_PLAYBOOKS.filter((playbook) =>
        playbook.orderedLoopTemplateIds.some((templateId) =>
          PREBUILT_COMPANY_LOOPS.some((item) => item.templateId === templateId && item.departmentType === departmentType)
        )
      )
    };
  }

  if (parsed.collection === "catalog" && parsed.id === "company-loops") {
    return {
      schemaVersion: COMPANY_LOOP_LIBRARY_SCHEMA_VERSION,
      routerEvaluationQuestions: HERMES_ROUTER_EVALUATION_QUESTIONS,
      departmentOperatingSkills: DEPARTMENT_OPERATING_SKILLS,
      prebuiltLoops: PREBUILT_COMPANY_LOOPS,
      sharedLearningPlaybooks: CROSS_DEPARTMENT_PLAYBOOKS
    };
  }

  if (parsed.collection === "discovery") {
    const session = await getDiscoverySession(parsed.id, projectRoot);
    if (!session) throw new Error(`Discovery session resource not found: ${parsed.id}`);
    return session;
  }

  if (parsed.collection === "loops") {
    const loops = await listLoopgraphLoops({ projectRoot });
    const loop = loops.loops.find((item) => item.loopId === parsed.id);
    if (!loop) throw new Error(`Loop resource not found: ${parsed.id}`);
    const loaded = await loadLoopSpecFromPath(loop.specPath);
    return {
      schemaVersion: "loop-resource/v1alpha1",
      loop,
      spec: loaded.ok ? loaded.spec : undefined,
      loadErrors: loaded.ok ? [] : loaded.errors
    };
  }

  if (parsed.collection === "graph" && parsed.id === "company") {
    return callLoopgraphMcpTool("loopgraph_graph_get", { projection: "design" }, options);
  }

  throw new Error(`Unsupported Loopgraph resource URI: ${uri}`);
}

async function handleToolCall(
  request: JsonRpcRequest & { id: JsonRpcId },
  options: LoopgraphMcpServerOptions
): Promise<JsonRpcResponse> {
  const params = isRecord(request.params) ? request.params : {};
  const name = params.name;

  if (!isLoopgraphMcpToolName(name)) {
    return errorResponse(request.id, -32601, "Tool not found", typeof name === "string" ? name : undefined);
  }
  if (!isToolAllowedForExposure(name, normalizeLoopgraphMcpExposure(options.exposure))) {
    return errorResponse(request.id, -32601, "Tool not found", typeof name === "string" ? name : undefined);
  }

  try {
    const structuredContent = await callLoopgraphMcpTool(
      name,
      isRecord(params.arguments) ? params.arguments : {},
      options
    );

    return resultResponse(request.id, {
      content: [{
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }],
      structuredContent,
      isError: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return resultResponse(request.id, {
      content: [{
        type: "text",
        text: message
      }],
      isError: true
    });
  }
}

async function callLoopgraphMcpTool(
  name: LoopgraphMcpToolName,
  input: Record<string, unknown>,
  options: LoopgraphMcpServerOptions
) {
  const boundInput = bindProjectRoot(input, options);

  if (isLoopgraphRoutingToolName(name)) {
    return callLoopgraphRoutingTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphRoutingOpsToolName(name)) {
    return callLoopgraphRoutingOpsTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphRoutingEvaluationToolName(name)) {
    return callLoopgraphRoutingEvaluationTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphHermesWebhookToolName(name)) {
    return callLoopgraphHermesWebhookTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphHermesOperationsToolName(name)) {
    return callLoopgraphHermesOperationsTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphWorkspaceToolName(name)) {
    return callLoopgraphWorkspaceTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphDesignToolName(name)) {
    return callLoopgraphDesignTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphHermesDesignToolName(name)) {
    return callLoopgraphHermesDesignTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphOpportunityToolName(name)) {
    return callLoopgraphOpportunityTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphRouteJobWorkerToolName(name)) {
    return callLoopgraphRouteJobWorkerTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphOutcomeToolName(name)) {
    return callLoopgraphOutcomeTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphControllerToolName(name)) {
    return callLoopgraphControllerTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphSemanticGraphToolName(name)) {
    return callLoopgraphSemanticGraphTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphProjectToolName(name)) {
    return callLoopgraphProjectTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphConnectionToolName(name)) {
    return callLoopgraphConnectionTool(name, boundInput, {
      projectRoot: options.projectRoot
    });
  }

  if (isLoopgraphMeasurementToolName(name)) {
    return callLoopgraphMeasurementTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphProviderToolName(name)) {
    return callLoopgraphProviderTool(name, boundInput);
  }

  if (isLoopgraphLoopToolName(name)) {
    return callLoopgraphLoopTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  if (isLoopgraphAppToolName(name)) {
    return callLoopgraphAppTool(name, boundInput, {
      projectRoot: options.projectRoot,
      now: options.now
    });
  }

  return callLoopgraphDiscoveryTool(name, boundInput, {
    projectRoot: options.projectRoot
  });
}

function bindProjectRoot(
  input: Record<string, unknown>,
  options: LoopgraphMcpServerOptions
): Record<string, unknown> {
  if (!options.projectRoot) return input;
  return {
    ...input,
    projectRoot: options.projectRoot
  };
}

function parseLoopgraphResourceUri(uri: string): { collection: string; id: string } {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid Loopgraph resource URI: ${uri}`);
  }
  if (parsed.protocol !== "loopgraph:") {
    throw new Error(`Unsupported resource protocol: ${parsed.protocol}`);
  }
  const id = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !id) {
    throw new Error(`Loopgraph resource URI must include a collection and id: ${uri}`);
  }
  return {
    collection: parsed.hostname,
    id
  };
}

function schemaResource(id: string) {
  if (id === "loop-design-context") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopDesignContextSchema, "LoopDesignContext")
    };
  }
  if (id === "loop-design-proposal-set") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopDesignProposalSetSchema, "LoopDesignProposalSet")
    };
  }
  if (id === "event-envelope") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(eventEnvelopeSchema, "EventEnvelope")
    };
  }
  if (id === "routing-card") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(routingCardSchema, "RoutingCard")
    };
  }
  if (id === "routing-decision") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(routingDecisionSchema, "RoutingDecision")
    };
  }
  if (id === "evidence-gap-set") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(evidenceGapSetSchema, "EvidenceGapSet")
    };
  }
  if (id === "hermes-design-task") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(hermesDesignTaskSchema, "HermesDesignTask")
    };
  }
  if (id === "hermes-agent-instance") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(hermesAgentInstanceSchema, "HermesAgentInstance")
    };
  }
  if (id === "hermes-execution-event") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(hermesExecutionEventSchema, "HermesExecutionEvent")
    };
  }
  if (id === "loop-opportunity") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopOpportunitySchema, "LoopOpportunity")
    };
  }
  if (id === "graph-change-set") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(graphChangeSetSchema, "GraphChangeSet")
    };
  }
  if (id === "metric-sample") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(metricSampleSchema, "MetricSample")
    };
  }
  if (id === "observed-outcome") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(observedOutcomeSchema, "ObservedOutcome")
    };
  }
  if (id === "value-ledger-entry") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(valueLedgerEntrySchema, "ValueLedgerEntry")
    };
  }
  if (id === "loop-controller-policy") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopControllerPolicySchema, "LoopControllerPolicy")
    };
  }
  if (id === "loop-controller-run") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopControllerRunSchema, "LoopControllerRun")
    };
  }
  if (id === "graph-snapshot") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(graphSnapshotSchema, "GraphSnapshot")
    };
  }
  if (id === "graph-change-approval-receipt") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(graphChangeApprovalReceiptSchema, "GraphChangeApprovalReceipt")
    };
  }
  if (id === "graph-transaction") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(graphTransactionSchema, "GraphTransaction")
    };
  }
  if (id === "loop-promotion-receipt") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(loopPromotionReceiptSchema, "LoopPromotionReceipt")
    };
  }
  if (id === "promotion-rehearsal") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(promotionRehearsalReportSchema, "PromotionRehearsal")
    };
  }
  if (id === "metric-binding") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(metricBindingSchema, "MetricBinding")
    };
  }
  if (id === "measurement-job") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(measurementJobSchema, "MeasurementJob")
    };
  }
  if (id === "connection-reconciliation") {
    return {
      schemaVersion: "mcp-schema-resource/v1alpha1",
      id,
      jsonSchema: zodToJsonSchema(connectionReconciliationReportSchema, "ConnectionReconciliation")
    };
  }
  throw new Error(`Schema resource not found: ${id}`);
}

function writeJsonLine(output: Writable, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}

function resultResponse(id: JsonRpcId, result: Record<string, unknown>): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function requestId(message: unknown): JsonRpcId | null {
  if (!isRecord(message)) return null;
  const id = message.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function isLoopgraphRoutingToolName(value: unknown): value is LoopgraphRoutingToolName {
  return typeof value === "string" && loopgraphRoutingToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphRoutingOpsToolName(value: unknown): value is LoopgraphRoutingOpsToolName {
  return typeof value === "string" && loopgraphRoutingOpsToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphRoutingEvaluationToolName(value: unknown): value is LoopgraphRoutingEvaluationToolName {
  return typeof value === "string" && loopgraphRoutingEvaluationToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphHermesWebhookToolName(value: unknown): value is LoopgraphHermesWebhookToolName {
  return typeof value === "string" && loopgraphHermesWebhookToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphHermesOperationsToolName(value: unknown): value is LoopgraphHermesOperationsToolName {
  return typeof value === "string" && loopgraphHermesOperationsToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphWorkspaceToolName(value: unknown): value is LoopgraphWorkspaceToolName {
  return typeof value === "string" && loopgraphWorkspaceToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphDiscoveryToolName(value: unknown): value is LoopgraphDiscoveryToolName {
  return typeof value === "string" && loopgraphDiscoveryToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphDesignToolName(value: unknown): value is LoopgraphDesignToolName {
  return typeof value === "string" && loopgraphDesignToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphHermesDesignToolName(value: unknown): value is LoopgraphHermesDesignToolName {
  return typeof value === "string" && loopgraphHermesDesignToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphOpportunityToolName(value: unknown): value is LoopgraphOpportunityToolName {
  return typeof value === "string" && loopgraphOpportunityToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphRouteJobWorkerToolName(value: unknown): value is LoopgraphRouteJobWorkerToolName {
  return typeof value === "string" && loopgraphRouteJobWorkerToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphOutcomeToolName(value: unknown): value is LoopgraphOutcomeToolName {
  return typeof value === "string" && loopgraphOutcomeToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphControllerToolName(value: unknown): value is LoopgraphControllerToolName {
  return typeof value === "string" && loopgraphControllerToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphSemanticGraphToolName(value: unknown): value is LoopgraphSemanticGraphToolName {
  return typeof value === "string" && loopgraphSemanticGraphToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphProjectToolName(value: unknown): value is LoopgraphProjectToolName {
  return typeof value === "string" && loopgraphProjectToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphConnectionToolName(value: unknown): value is LoopgraphConnectionToolName {
  return typeof value === "string" && loopgraphConnectionToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphMeasurementToolName(value: unknown): value is LoopgraphMeasurementToolName {
  return typeof value === "string" && loopgraphMeasurementToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphProviderToolName(value: unknown): value is LoopgraphProviderToolName {
  return typeof value === "string" && loopgraphProviderToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphLoopToolName(value: unknown): value is LoopgraphLoopToolName {
  return typeof value === "string" && loopgraphLoopToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphAppToolName(value: unknown): value is LoopgraphAppToolName {
  return typeof value === "string" && loopgraphAppToolDefinitions.some((tool) => tool.name === value);
}

function isLoopgraphMcpToolName(value: unknown): value is LoopgraphMcpToolName {
  return isLoopgraphRoutingToolName(value) ||
    isLoopgraphRoutingOpsToolName(value) ||
    isLoopgraphRoutingEvaluationToolName(value) ||
    isLoopgraphHermesWebhookToolName(value) ||
    isLoopgraphHermesOperationsToolName(value) ||
    isLoopgraphWorkspaceToolName(value) ||
    isLoopgraphDiscoveryToolName(value) ||
    isLoopgraphProjectToolName(value) ||
    isLoopgraphDesignToolName(value) ||
    isLoopgraphHermesDesignToolName(value) ||
    isLoopgraphOpportunityToolName(value) ||
    isLoopgraphRouteJobWorkerToolName(value) ||
    isLoopgraphOutcomeToolName(value) ||
    isLoopgraphControllerToolName(value) ||
    isLoopgraphSemanticGraphToolName(value) ||
    isLoopgraphConnectionToolName(value) ||
    isLoopgraphMeasurementToolName(value) ||
    isLoopgraphProviderToolName(value) ||
    isLoopgraphLoopToolName(value) ||
    isLoopgraphAppToolName(value);
}

function isToolAllowedForExposure(name: LoopgraphMcpToolName, exposure: LoopgraphMcpExposure): boolean {
  if (exposure === "admin") return true;
  if (exposure === "webhook_router") return (LOOPGRAPH_WEBHOOK_ROUTER_MCP_TOOL_NAMES as readonly string[]).includes(name);
  return (LOOPGRAPH_LIFECYCLE_ROUTER_MCP_TOOL_NAMES as readonly string[]).includes(name);
}

function isResourceAllowedForExposure(uri: string, exposure: LoopgraphMcpExposure): boolean {
  if (exposure === "admin") return true;
  return LOOPGRAPH_ROUTER_SCHEMA_RESOURCE_URIS.has(uri) || uri === "loopgraph://graph/company";
}

function mcpInstructionsForExposure(exposure: LoopgraphMcpExposure): string {
  if (exposure === "webhook_router") {
    return "Loopgraph exposes only bounded event-ingest, routing-decision, routing-state, and graph tools for isolated Hermes webhook-router turns.";
  }
  if (exposure === "lifecycle_router") {
    return "Loopgraph exposes only lifecycle event receipt, lifecycle state read, and graph tools for notification-only Hermes lifecycle turns.";
  }
  return "Loopgraph exposes project-bound workspace, department, discovery, design, semantic graph transaction, local runtime, and routing administration tools for trusted Hermes/operator turns.";
}

function isReadOnlyToolName(name: LoopgraphMcpToolName): boolean {
  if (isLoopgraphAppToolName(name)) {
    return loopgraphAppToolDefinitions.find((tool) => tool.name === name)?.readOnly ?? false;
  }
  if (isLoopgraphHermesOperationsToolName(name)) {
    return loopgraphHermesOperationsToolDefinitions.find((tool) => tool.name === name)?.readOnly ?? false;
  }
  if (isLoopgraphSemanticGraphToolName(name)) {
    return loopgraphSemanticGraphToolDefinitions
      .find((tool) => tool.name === name)?.readOnly ?? false;
  }
  if (isLoopgraphMeasurementToolName(name)) {
    return loopgraphMeasurementToolDefinitions
      .find((tool) => tool.name === name)?.readOnly ?? false;
  }
  if (isLoopgraphConnectionToolName(name)) {
    return loopgraphConnectionToolDefinitions
      .find((tool) => tool.name === name)?.readOnly ?? false;
  }
  if (isLoopgraphProviderToolName(name)) {
    return loopgraphProviderToolDefinitions.find((tool) => tool.name === name)?.readOnly ?? false;
  }
  return name === "loopgraph_workspace_inspect" ||
    name === "loopgraph_departments_list" ||
    name === "loopgraph_discovery_get" ||
    name === "loopgraph_discovery_next_questions" ||
    name === "loopgraph_project_inspect" ||
    name === "loopgraph_design_context_get" ||
    name === "loopgraph_hermes_design_tasks_get" ||
    name === "loopgraph_opportunities_get" ||
    name === "loopgraph_graph_changes_get" ||
    name === "loopgraph_metric_samples_get" ||
    name === "loopgraph_outcomes_get" ||
    name === "loopgraph_value_ledger_get" ||
    name === "loopgraph_controller_runs_get" ||
    name === "loopgraph_controller_policy_get" ||
    name === "loopgraph_loops_list" ||
    name === "loopgraph_runs_get" ||
    name === "loopgraph_loops_validate" ||
    name === "loopgraph_routing_catalog_get" ||
    name === "loopgraph_events_get" ||
    name === "loopgraph_problems_get" ||
    name === "loopgraph_routing_decision_get" ||
    name === "loopgraph_route_jobs_get" ||
    name === "loopgraph_routing_evaluations_get" ||
    name === "loopgraph_lifecycle_events_get" ||
    name === "loopgraph_graph_get" ||
    name === "loopgraph_hermes_webhooks_plan" ||
    name === "loopgraph_hermes_webhooks_doctor";
}

function isIdempotentToolName(name: LoopgraphMcpToolName): boolean {
  if (isLoopgraphAppToolName(name)) {
    return loopgraphAppToolDefinitions.find((tool) => tool.name === name)?.idempotent ?? false;
  }
  if (isLoopgraphHermesOperationsToolName(name)) {
    return loopgraphHermesOperationsToolDefinitions.find((tool) => tool.name === name)?.idempotent ?? false;
  }
  if (isLoopgraphSemanticGraphToolName(name)) {
    return loopgraphSemanticGraphToolDefinitions
      .find((tool) => tool.name === name)?.idempotent ?? false;
  }
  if (isLoopgraphMeasurementToolName(name)) {
    return loopgraphMeasurementToolDefinitions
      .find((tool) => tool.name === name)?.idempotent ?? false;
  }
  if (isLoopgraphConnectionToolName(name)) {
    return loopgraphConnectionToolDefinitions
      .find((tool) => tool.name === name)?.idempotent ?? false;
  }
  if (isLoopgraphProviderToolName(name)) {
    return loopgraphProviderToolDefinitions.find((tool) => tool.name === name)?.idempotent ?? false;
  }
  return ![
    "loopgraph_discovery_start",
    "loopgraph_discovery_select_departments",
    "loopgraph_discovery_submit_answers",
    "loopgraph_design_generate",
    "loopgraph_design_submit",
    "loopgraph_design_edit",
    "loopgraph_evidence_gap_answer",
    "loopgraph_opportunity_dismiss",
    "loopgraph_route_worker_run",
    "loopgraph_route_job_retry",
    "loopgraph_route_job_cancel",
    "loopgraph_loops_materialize",
    "loopgraph_loops_simulate",
    "loopgraph_review_submit",
    "loopgraph_case_resolve",
    "loopgraph_events_replay",
    "loopgraph_routing_decision_submit",
    "loopgraph_routing_human_choice_submit",
    "loopgraph_routing_evaluation_run",
    "loopgraph_route_commit_simulate",
    "loopgraph_hermes_webhooks_test"
  ].includes(name);
}

function isDestructiveToolName(name: LoopgraphMcpToolName): boolean {
  if (isLoopgraphAppToolName(name)) {
    return loopgraphAppToolDefinitions.find((tool) => tool.name === name)?.destructive ?? false;
  }
  return name === "loopgraph_graph_change_apply" ||
    name === "loopgraph_loop_promote" ||
    name === "loopgraph_loop_lifecycle_set" ||
    name === "loopgraph_graph_rollback";
}

function titleFromToolName(name: string): string {
  return name
    .replace(/^loopgraph_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
