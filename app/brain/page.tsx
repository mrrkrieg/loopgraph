import { BrainPageShell } from "@/components/brain/brain-page-shell";
import { isHostedPreview } from "@/lib/hosted-preview";
import { getSemanticTopology } from "@/lib/loop-engineering-builder/workspace";
import { getGraphAuthoringContext } from "../../lib/loopgraph-runtime/graph-authoring-store-resolver";
import { contentHash } from "loopgraph/core";
import {
  projectGraphEditorTransactionReceipts,
  graphEditorTransactionReceipt,
  inspectLocalSupervisorRuntime
} from "loopgraph/runtime";
import {
  getActiveLoopgraphProjectRoot,
  getHermesDesignStore,
  getLoopOpportunityStore
} from "../../lib/loopgraph-runtime/storage-resolver";

type BrainPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrainPage({ searchParams }: BrainPageProps) {
  const params = await searchParams;
  const catalogParam = firstParam(params?.catalog);
  const catalogExplicitlyShown = catalogParam === "1" || catalogParam === "true";
  const catalogExplicitlyHidden = catalogParam === "0" || catalogParam === "false";
  const hostedPreview = isHostedPreview();
  const previewMode = hostedPreview && !catalogExplicitlyHidden;
  const includeCatalogLoops = catalogExplicitlyShown || previewMode;
  const topology = await getSemanticTopology(undefined, {
    includeCatalogLoops,
    brainLabel: "Hermes Brain",
    hierarchyMode: "hermes_brain"
  });
  const activeProjectRoot = getActiveLoopgraphProjectRoot();
  const { store: graphAuthoringStore } = await getGraphAuthoringContext("workspace.read");
  const [layout, transactions, supervisorRuntime] = await Promise.all([
    graphAuthoringStore.getLayout(),
    graphAuthoringStore.list(),
    hostedPreview ? Promise.resolve(undefined) : inspectLocalSupervisorRuntime(activeProjectRoot)
  ]);
  const transactionReceipts = hostedPreview
    ? transactions.map(graphEditorTransactionReceipt)
    : await projectGraphEditorTransactionReceipts({
        transactions,
        opportunityStore: getLoopOpportunityStore({
          projectRoot: activeProjectRoot
        }),
        designStore: getHermesDesignStore()
      });
  const supervisor = supervisorRuntime
    ? {
        running: supervisorRuntime.running,
        ...(supervisorRuntime.status
          ? {
              status: {
                health: supervisorRuntime.status.health,
                checkedAt: supervisorRuntime.status.checkedAt,
                recommendedAction: supervisorRuntime.status.recommendedActions[0]
              }
            }
          : {})
      }
    : undefined;

  return (
    <BrainPageShell
      includeCatalogLoops={includeCatalogLoops}
      initialLayout={layout}
      initialTransactions={transactionReceipts}
      previewMode={previewMode}
      supervisor={supervisor}
      topology={topology}
      topologyHash={contentHash({ nodes: topology.nodes, edges: topology.edges })}
    />
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
