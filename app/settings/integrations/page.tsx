import { PageHeader } from "@/components/page-header";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import {
  getExternalConnectorBrokerClient,
  listConnectorInstallations,
  listConnectorKillSwitches,
  listProviderDetectorOperations,
  listWorkloadIdentities
} from "@/lib/connector-broker/admin";
import { PROVIDER_ONBOARDING_CATALOG } from "loopgraph/runtime";
import { IntegrationAdmin } from "./integration-admin";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ provider?: string }>;
}) {
  const database = await getWorkspaceDatabase("integrations.read");
  const requestedProvider = (await searchParams)?.provider;
  const initialProviderId = PROVIDER_ONBOARDING_CATALOG.some((provider) => provider.providerId === requestedProvider)
    ? requestedProvider
    : undefined;
  const [installations, workloadIdentities, killSwitches, detectors] = await Promise.all([
    listConnectorInstallations(database),
    listWorkloadIdentities(database),
    listConnectorKillSwitches(database),
    listProviderDetectorOperations(database)
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
        initialDetectors={detectors}
        providers={PROVIDER_ONBOARDING_CATALOG}
        initialProviderId={initialProviderId}
        brokerConfigured={Boolean(getExternalConnectorBrokerClient())}
      />
    </>
  );
}
