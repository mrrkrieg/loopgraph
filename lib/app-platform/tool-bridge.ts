import "server-only";

import {
  callLoopgraphAppTool as callRuntimeAppTool,
  connectionInstanceFromBrokerInstallation,
  type LoopgraphAppToolName
} from "loopgraph/runtime";
import type { ConnectionInstance } from "loopgraph/core";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import { listConnectorInstallations } from "@/lib/connector-broker/admin";

const CONNECTION_AWARE_TOOLS = new Set<LoopgraphAppToolName>([
  "loopgraph_app_install_plan",
  "loopgraph_connector_schema_record",
  "loopgraph_app_field_mappings_get",
  "loopgraph_app_field_mapping_confirm",
  "loopgraph_app_update_plan"
]);

/**
 * Server-only App Platform entry point.
 *
 * Connector Broker installations are projected into the generic connection
 * contract through trusted call options. They are never accepted from browser,
 * MCP, or CLI input, and the projection intentionally omits every credential
 * and vault reference.
 */
export async function callLoopgraphAppTool(
  name: LoopgraphAppToolName,
  input: unknown,
  options: { projectRoot?: string; now?: Date } = {}
): Promise<unknown> {
  if (!CONNECTION_AWARE_TOOLS.has(name)) {
    return callRuntimeAppTool(name, input, options);
  }
  const database = await getWorkspaceDatabase("integrations.read");
  const installations = await listConnectorInstallations(database);
  const connections: ConnectionInstance[] = installations.map((installation) =>
    connectionInstanceFromBrokerInstallation(installation)
  );
  return callRuntimeAppTool(name, input, { ...options, connections });
}

export type { LoopgraphAppToolName };
