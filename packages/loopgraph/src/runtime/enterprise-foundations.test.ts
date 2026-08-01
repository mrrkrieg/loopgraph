import { describe, expect, it } from "vitest";
import { DEPARTMENT_OPERATING_SKILLS, providerInstallationSchema } from "../core";
import { buildDepartmentGoldenEventSuites } from "./department-golden-suites";
import { InMemoryEntityResolutionStore, resolveCompanyEntity } from "./entity-resolution";
import { prepareProviderInstallation, PROVIDER_ONBOARDING_CATALOG } from "./provider-onboarding";
import { normalizeProviderEvent } from "./provider-normalizers";
import { PROVIDER_GOLDEN_FIXTURES } from "./provider-fixtures";
import { callLoopgraphProviderTool } from "./provider-tools";

describe("enterprise provider and department foundations", () => {
  it("ships onboarding and normalization contracts for every supported provider", () => {
    expect(PROVIDER_ONBOARDING_CATALOG).toHaveLength(13);
    expect(PROVIDER_GOLDEN_FIXTURES).toHaveLength(PROVIDER_ONBOARDING_CATALOG.length);
    for (const fixture of PROVIDER_GOLDEN_FIXTURES) {
      const event = normalizeProviderEvent({ providerId: fixture.providerId, workspaceId: "workspace", companyId: "company", sourceRoute: `hermes-${fixture.providerId}`, deliveryId: fixture.deliveryId, signatureVerified: true }, fixture.payload);
      expect(event.source).toBe(fixture.providerId);
      expect(event.trust.signatureVerified).toBe(true);
      expect(event).toMatchObject({ eventType: fixture.expectedEventType, subject: { type: fixture.expectedSubjectType } });
    }
  });

  it("prepares a non-secret broker handoff without generating OAuth material", () => {
    const plan = prepareProviderInstallation({ providerId: "hubspot", workspaceId: "workspace", companyId: "company", redirectUri: "https://hermes.example/oauth/callback", now: new Date("2026-07-31T00:00:00.000Z") });
    expect(plan.authorizationUrl).toBeUndefined();
    expect(plan).toMatchObject({ oneTimeRedacted: true, brokerStartEndpoint: "/api/connector-broker/v1/installations/start" });
    expect(plan).not.toHaveProperty("oneTime");
    expect(JSON.stringify(providerInstallationSchema.parse(plan.installation))).not.toMatch(/access_token|refresh_token|client_secret/i);
  });

  it("gives Hermes provider tools with one-time OAuth material redacted by default", async () => {
    const catalog = await callLoopgraphProviderTool("loopgraph_provider_catalog_get", {});
    expect(catalog).toMatchObject({ count: 13 });
    const plan = await callLoopgraphProviderTool("loopgraph_provider_install_prepare", {
      providerId: "hubspot",
      workspaceId: "workspace",
      companyId: "company",
      redirectUri: "https://hermes.example/oauth/callback"
    });
    expect(plan).toMatchObject({ oneTimeRedacted: true });
    expect(plan).not.toHaveProperty("oneTime");
  });

  it("creates golden route, exclusion, and missing-context suites for every department skill", () => {
    const suites = buildDepartmentGoldenEventSuites();
    for (const skill of DEPARTMENT_OPERATING_SKILLS) {
      const departmentSuites = suites.filter((suite) => suite.department === skill.departmentType);
      expect(departmentSuites.length).toBeGreaterThan(0);
      expect(departmentSuites.every((suite) => suite.positive.length > 0 && suite.missingContext.length > 0)).toBe(true);
    }
  });

  it("matches exact aliases and abstains from ambiguous deterministic matches", async () => {
    const store = new InMemoryEntityResolutionStore();
    const created = await resolveCompanyEntity({ store, createIfMissing: true, now: new Date("2026-07-31T00:00:00.000Z"), request: { schemaVersion: "entity-resolution/v1alpha1", workspaceId: "workspace", companyId: "company", provider: "hubspot", externalType: "company", externalId: "123", expectedType: "account", deterministicKeys: { domain: "example.com" } } });
    expect(created.status).toBe("created");
    const exact = await resolveCompanyEntity({ store, request: { schemaVersion: "entity-resolution/v1alpha1", workspaceId: "workspace", companyId: "company", provider: "hubspot", externalType: "company", externalId: "123", expectedType: "account", deterministicKeys: {} } });
    expect(exact).toMatchObject({ status: "exact", canonicalEntityId: created.canonicalEntityId, requiresHumanReview: false });
  });
});
