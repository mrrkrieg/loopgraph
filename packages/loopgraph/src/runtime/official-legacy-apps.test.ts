import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  appEvalSuiteSchema,
  appSetupDefinitionSchema,
  type WorkspaceAppInstallation
} from "../core";
import { loadConnectorRecipes } from "./app-connector-service";
import { compileLoopPack } from "./app-pack-compiler";
import { loadLoopPackDirectory } from "./app-pack-loader";
import { LocalAppMarketplace } from "./app-marketplace";
import { runAppSyntheticConformance } from "./app-quality-engine";

const packsRoot = path.resolve(process.cwd(), "packs");
const temporaryDirectories: string[] = [];

const migratedApps = [
  {
    root: "official/engineering/triage-github-issues",
    appId: "loopgraph.engineering.triage-github-issues",
    loopId: "engineering-github-issue-triage"
  },
  {
    root: "official/customer-success/triage-support-tickets",
    appId: "loopgraph.customer-success.triage-support-tickets",
    loopId: "customer-success-support-ticket-triage"
  },
  {
    root: "official/customer-success/escalate-strategic-accounts",
    appId: "loopgraph.customer-success.escalate-strategic-accounts",
    loopId: "customer-success-strategic-account-escalation"
  }
] as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("official apps migrated from legacy templates", () => {
  it.each(migratedApps)("loads, compiles, and passes the complete safety suite for $appId", async ({ root, appId, loopId }) => {
    const packRoot = path.join(packsRoot, root);
    const loaded = await loadLoopPackDirectory(packRoot, { loopgraphVersion: "0.2.0", hermesVersion: "1.0.0" });
    const compiled = await compileLoopPack(loaded);
    const connectors = await loadConnectorRecipes(loaded);
    const setup = appSetupDefinitionSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.setup[0]), "utf8")));
    const suite = appEvalSuiteSchema.parse(YAML.parse(await readFile(path.join(packRoot, loaded.manifest.entrypoints.evals[0]), "utf8")));

    expect(compiled).toMatchObject({ appId, loopSpecs: [{ metadata: { id: loopId } }] });
    expect(compiled.routingCards).toHaveLength(1);
    expect(compiled.skills).toHaveLength(1);
    expect(connectors).toHaveLength(1);
    expect(setup.questions.length).toBeGreaterThanOrEqual(6);
    expect(suite.scenarios).toHaveLength(13);

    const installation = {
      id: `install.${appId}`,
      appId,
      version: loaded.manifest.metadata.version,
      artifactDigest: loaded.artifact.digest,
      permissions: loaded.manifest.permissions.map((permission) => ({
        capability: permission.capability,
        authority: permission.authority,
        decision: permission.defaultPolicy === "allowed" ? "allow" : permission.defaultPolicy
      }))
    } as WorkspaceAppInstallation;
    const evaluation = await runAppSyntheticConformance({
      loaded,
      compiled,
      installation,
      actor: "official-pack-test",
      now: new Date("2026-08-09T12:00:00.000Z")
    });
    const failedScenarios = evaluation.scenarios.filter((scenario) => scenario.status === "failed");
    expect(failedScenarios, JSON.stringify(failedScenarios, null, 2)).toEqual([]);
    expect(evaluation).toMatchObject({ status: "passed", writeBlocked: true, metrics: { failed: 0, providerWrites: 0 } });
    expect(evaluation.scenarios).toHaveLength(13);
  });

  it("indexes every deep official app plus the three legacy migrations in the official marketplace", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "loopgraph-official-apps-"));
    temporaryDirectories.push(stateRoot);
    const marketplace = new LocalAppMarketplace(stateRoot, packsRoot);
    const apps = await marketplace.refreshAllCatalogSources();
    expect(apps.map((app) => app.id)).toEqual(expect.arrayContaining([
      "loopgraph.sales.qualify-route-inbound-leads",
      "loopgraph.sales.find-recover-cold-deals",
      "loopgraph.product.turn-feedback-into-product-problems",
      "loopgraph.marketing.learn-qualified-pipeline",
      "loopgraph.engineering.run-issue-incident-operations",
      "loopgraph.customer-success.catch-renewal-risk",
      "loopgraph.ops-finance.manage-forecast-controls",
      "loopgraph.hr-talent.operate-people-workflows",
      "loopgraph.legal-compliance.govern-evidence-and-exceptions",
      "loopgraph.management.run-company-operating-system",
      ...migratedApps.map((app) => app.appId)
    ]));
    expect(apps.length).toBeGreaterThanOrEqual(13);
  });
});
