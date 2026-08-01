import { PageHeader } from "@/components/page-header";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  getExternalConnectorBrokerClient,
  listConnectorInstallations,
  listConnectorKillSwitches,
  listWorkloadIdentities
} from "@/lib/connector-broker/admin";
import { PROVIDER_ONBOARDING_CATALOG } from "loopgraph/runtime";
import { IntegrationAdmin } from "./integration-admin";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const database = await getWorkspaceDatabase("integrations.read");
  const [installations, workloadIdentities, killSwitches] = await Promise.all([
    listConnectorInstallations(database),
    listWorkloadIdentities(database),
    listConnectorKillSwitches(database)
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Enterprise security"
        title="Provider integrations"
        description="Connect company systems through the Hermes Connector Broker without exposing provider credentials to Loopgraph, chat, browser storage, logs, or traces."
      />
      <IntegrationAdmin
        initialInstallations={installations}
        initialWorkloadIdentities={workloadIdentities}
        initialKillSwitches={killSwitches}
        providers={PROVIDER_ONBOARDING_CATALOG}
        brokerConfigured={Boolean(getExternalConnectorBrokerClient())}
      />
    </>
  );
}
