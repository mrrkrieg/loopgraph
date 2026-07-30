import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLoopSpecFromPath } from "./loader";
import { generateDeterministicLoopDesign } from "./design-service";
import { simulateLoop } from "./simulator";
import {
  listLoopgraphLoops,
  materializeAcceptedLoopDesignProposals
} from "./loop-materialization";
import { FileStorageAdapter } from "../sdk/storage";
import { loopgraph_routing_catalog_get } from "./routing-tools";
import {
  selectDiscoveryDepartments,
  startHermesDiscoverySession,
  submitDiscoveryAnswers
} from "./discovery-session";
import { inspectLoopgraphWorkspace, readLoopgraphWorkspace } from "./workspace";
import type {
  LoopSpecMaterializationCommitInput,
  LoopSpecRegistryStore,
  StoredLoopSpecArtifact
} from "./loop-spec-store";

async function temporaryProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "loopgraph-materialize-"));
}

describe("Hermes loop materialization", () => {
  it("materializes accepted marketing proposals into registered routing-ready LoopSpecs", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const design = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: "session_materialize",
      now: new Date("2026-07-21T12:10:00.000Z")
    });

    const result = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      designRunId: design.designRun.id,
      acceptedProposalIds: ["proposal_marketing_ads", "proposal_marketing_content_creation"],
      acceptedBy: "user",
      now: new Date("2026-07-21T12:20:00.000Z")
    });

    expect(result).toMatchObject({
      schemaVersion: "loop-materialization/v1alpha1",
      valid: true,
      errors: [],
      sessionId: "session_materialize",
      materializedLoops: [
        expect.objectContaining({
          proposalId: "proposal_marketing_ads",
          loopId: "marketing_ads",
          department: "marketing",
          status: "created",
          requiredConnections: expect.arrayContaining([
            expect.objectContaining({ capability: "ads.read", requiredFor: "routing" })
          ])
        }),
        expect.objectContaining({
          proposalId: "proposal_marketing_content_creation",
          loopId: "marketing_content_creation",
          department: "marketing",
          status: "created"
        })
      ],
      workspace: {
        registeredSpecCount: 2,
        registeredDepartments: ["marketing"],
        routingReadySpecCount: 2
      },
      graphProjection: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "company_brain", label: "Hermes Brain" }),
          expect.objectContaining({ id: "department:marketing", label: "Marketing" }),
          expect.objectContaining({ id: "loop:marketing_ads", label: "Ads" }),
          expect.objectContaining({ id: "loop:marketing_content_creation", label: "Content Creation" })
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ source: "company_brain", target: "department:marketing" }),
          expect.objectContaining({ source: "department:marketing", target: "loop:marketing_ads" }),
          expect.objectContaining({ source: "department:marketing", target: "loop:marketing_content_creation" })
        ])
      }
    });
    expect(result.nextActions.join(" ")).toContain("Connect or provide manual fallback data");
    await access(result.materializationPath!);

    const registry = await readLoopgraphWorkspace(projectRoot);
    expect(registry.registeredSpecs.map((spec) => spec.id)).toEqual([
      "marketing_ads",
      "marketing_content_creation"
    ]);
    expect(registry.registeredSpecs.every((spec) => spec.path.startsWith(".loopgraph/generated/hermes/marketing/"))).toBe(true);

    for (const loop of result.materializedLoops) {
      const loaded = await loadLoopSpecFromPath(loop.specPath);
      expect(loop.simulation.needsFixture).toBe(true);
      expect(loop.simulation.starterFixtures.map((fixture) => fixture.id)).toEqual([
        "happy-path",
        "missing-context",
        "risk-escalation"
      ]);
      expect(loop.simulation.command).toContain("fixtures/happy-path.json");

      for (const fixture of loop.simulation.starterFixtures) {
        await access(fixture.path);
        expect(fixture.relativePath).toBe(`fixtures/${fixture.id}.json`);
      }

      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.spec.input.fixtures?.map((fixture) => fixture.id)).toEqual([
          "happy-path",
          "missing-context",
          "risk-escalation"
        ]);
        expect(loaded.spec.routing?.problemTypes).toEqual(loop.routingCard.problemTypes);
        expect(loaded.spec.routing?.requiredConnections).toEqual(loop.routingCard.requiredConnections);
        if (loop.loopId === "marketing_ads") {
          expect(loaded.spec.routing).toMatchObject({
            ambiguityPolicy: "request_human",
            noMatchPolicy: "unhandled",
            fanoutPolicy: {
              mode: "independent_only",
              maxRoutes: 2,
              requiresIndependentProblems: true
            },
            cooldown: {
              seconds: 0,
              dedupeWindowSeconds: 3600
            },
            concurrency: {
              maxActive: 1,
              strategy: "append_evidence"
            },
            examples: {
              shouldRoute: expect.arrayContaining([
                "Campaign spend rises while qualified customer conversion drops.",
                "Event includes spend delta"
              ]),
              shouldNotRoute: expect.arrayContaining([
                "test campaigns and already-resolved anomalies"
              ])
            }
          });
          expect(loaded.spec.routing?.lifecycleEvents).toEqual(expect.arrayContaining([
            "loop.route.accepted",
            "loop.run.completed",
            "loop.review.required",
            "loop.run.failed",
            "loop.outcome.recorded",
            "loop.problem.unhandled"
          ]));
          expect(loop.routingCard).toMatchObject({
            ambiguityPolicy: "request_human",
            noMatchPolicy: "unhandled",
            fanoutPolicy: {
              mode: "independent_only",
              maxRoutes: 2
            },
            cooldown: {
              dedupeWindowSeconds: 3600
            },
            concurrency: {
              strategy: "append_evidence"
            },
            examples: {
              shouldNotRoute: expect.arrayContaining([
                "test campaigns and already-resolved anomalies"
              ])
            },
            lifecycleEvents: expect.arrayContaining([
              "loop.route.accepted",
              "loop.run.completed",
              "loop.problem.unhandled"
            ])
          });
          expect(loaded.spec.routing?.requiredConnections).toEqual(expect.arrayContaining([
            "ads.read",
            "crm.read",
            "analytics.read"
          ]));
        }
        if (loop.loopId === "marketing_content_creation") {
          expect(loaded.spec.routing?.requiredConnections).toEqual(expect.arrayContaining([
            "content_repository.read",
            "content_repository.draft_write",
            "cms.draft"
          ]));
        }
        expect(loaded.spec.metadata.labels).toMatchObject({
          source: "hermes-design",
          proposalId: loop.proposalId,
          designRunId: design.designRun.id
        });

        const happyFixture = JSON.parse(await readFile(loop.simulation.starterFixtures[0]!.path, "utf8"));
        expect(happyFixture).toMatchObject({
          synthetic: true,
          scenario: "happy-path",
          loopId: loop.loopId,
          trigger: {
            sourceRoute: expect.stringMatching(/^hermes\./),
            trust: {
              signer: "synthetic-fixture"
            }
          }
        });

        const missingContextFixture = JSON.parse(await readFile(loop.simulation.starterFixtures[1]!.path, "utf8"));
        expect(missingContextFixture).toMatchObject({
          synthetic: true,
          scenario: "missing-context",
          expectedAssessment: {
            escalationRequest: {
              required: true,
              category: "missing_context"
            }
          }
        });
        expect(missingContextFixture.contextOverrides.missingContext.length).toBeGreaterThan(0);

        const riskFixture = JSON.parse(await readFile(loop.simulation.starterFixtures[2]!.path, "utf8"));
        expect(riskFixture).toMatchObject({
          synthetic: true,
          scenario: "risk-escalation",
          expectedAssessment: {
            escalationRequest: {
              required: true,
              category: "risk_review"
            }
          }
        });

        const simulation = await simulateLoop({
          spec: loaded.spec,
          fixture: loop.simulation.starterFixtures[0]!.path,
          storage: new FileStorageAdapter(path.join(projectRoot, ".loopgraph", "simulation-test"))
        });
        expect(["COMPLETED", "WAITING_FOR_REVIEW"]).toContain(simulation.trace.status);
        expect(simulation.trace.agentOutput?.decisionSummary).toContain("synthetic");
      }
    }

    const catalog = await loopgraph_routing_catalog_get({ projectRoot });
    expect(catalog.count).toBe(2);
    expect(catalog.routingCards.map((card) => card.loopId)).toEqual([
      "marketing_ads",
      "marketing_content_creation"
    ]);
    expect(catalog.routingCards.every((card) => card.currentReadiness === "degraded")).toBe(true);
    expect(catalog.routingCards.find((card) => card.loopId === "marketing_ads")).toMatchObject({
      ambiguityPolicy: "request_human",
      noMatchPolicy: "unhandled",
      fanoutPolicy: {
        mode: "independent_only",
        maxRoutes: 2
      },
      concurrency: {
        strategy: "append_evidence"
      },
      examples: {
        shouldNotRoute: expect.arrayContaining([
          "test campaigns and already-resolved anomalies"
        ])
      },
      lifecycleEvents: expect.arrayContaining([
        "loop.route.accepted",
        "loop.problem.unhandled"
      ])
    });
    expect(catalog.routingCards.find((card) => card.loopId === "marketing_ads")?.requiredConnections).toEqual(expect.arrayContaining([
      "ads.read",
      "crm.read",
      "analytics.read"
    ]));

    const loops = await listLoopgraphLoops({ projectRoot });
    expect(loops.count).toBe(2);
    expect(loops.loops.every((loop) => loop.routingReady)).toBe(true);
    expect(loops.graphProjection.edges).toContainEqual(expect.objectContaining({
      source: "department:marketing",
      target: "loop:marketing_ads",
      executable: true
    }));

    const repeat = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      designRunId: design.designRun.id,
      acceptedProposalIds: ["proposal_marketing_ads", "proposal_marketing_content_creation"],
      acceptedBy: "user",
      now: new Date("2026-07-21T12:30:00.000Z")
    });
    expect(repeat.valid).toBe(true);
    expect(repeat.materializedLoops.map((loop) => loop.status)).toEqual([
      "already_materialized",
      "already_materialized"
    ]);
    expect((await inspectLoopgraphWorkspace({ projectRoot })).registeredSpecCount).toBe(2);
  });

  it("commits hosted LoopSpecs and the discovery transition through one distributed store call", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const design = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: "session_materialize",
      now: new Date("2026-07-21T12:10:00.000Z")
    });
    const loopSpecStore = new RecordingDistributedLoopSpecStore();

    const result = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      loopSpecStore,
      designRunId: design.designRun.id,
      acceptedProposalIds: ["proposal_marketing_ads"],
      acceptedBy: "browser",
      now: new Date("2026-07-21T12:20:00.000Z")
    });

    expect(result).toMatchObject({
      valid: true,
      materializedLoops: [
        expect.objectContaining({
          loopId: "marketing_ads",
          specPath: expect.stringContaining("registry://marketing_ads/")
        })
      ],
      workspace: {
        registeredSpecCount: 1,
        registeredDepartments: ["marketing"],
        routingReadySpecCount: 1
      },
      materializationPath: expect.stringContaining("registry-commit://")
    });
    expect(loopSpecStore.commits).toHaveLength(1);
    const commit = loopSpecStore.commits[0]!;
    expect(commit.expectedRevision).toBe(0);
    expect(commit.artifacts[0]).toMatchObject({
      loopId: "marketing_ads",
      source: "hermes_design"
    });
    expect(
      commit.artifacts[0]!.fixtures["fixtures/happy-path.json"]
    ).toMatchObject({ synthetic: true });
    expect(commit.discoverySessionTransition).toMatchObject({
      expectedRevision: expect.any(Number),
      session: expect.objectContaining({
        id: "session_materialize",
        status: "completed",
        activeStage: "materialization",
        createdLoopIds: ["marketing_ads"]
      })
    });
    await expect(access(path.join(
      projectRoot,
      ".loopgraph",
      "generated",
      "hermes",
      "marketing",
      "marketing_ads",
      "loopgraph.yaml"
    ))).rejects.toThrow();
  });

  it("requires explicit accepted proposal IDs before writing LoopSpecs", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const design = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: "session_materialize",
      now: new Date("2026-07-21T12:10:00.000Z")
    });

    const result = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      designRunId: design.designRun.id,
      acceptedProposalIds: [],
      now: new Date("2026-07-21T12:20:00.000Z")
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("acceptedProposalIds must contain at least one explicitly accepted proposal ID.");
    const workspace = await readFile(path.join(projectRoot, ".loopgraph", "workspace.json"), "utf8");
    expect(workspace).toContain('"registeredSpecs": []');
  });

  it("rolls back promoted files and registry changes when multi-loop materialization cannot commit atomically", async () => {
    const projectRoot = await createCompletedMarketingDiscoverySession();
    const design = await generateDeterministicLoopDesign({
      projectRoot,
      sessionId: "session_materialize",
      now: new Date("2026-07-21T12:10:00.000Z")
    });

    const proposalSetPath = path.join(
      projectRoot,
      ".loopgraph",
      "discovery",
      "proposals",
      `${design.designRun.id}.json`
    );
    const proposalSet = JSON.parse(await readFile(proposalSetPath, "utf8")) as {
      proposals: Array<Record<string, unknown>>;
    };
    proposalSet.proposals = proposalSet.proposals.map((proposal) =>
      proposal.proposalId === "proposal_marketing_content_creation"
        ? {
            ...proposal,
            department: "sales",
            loopSpecId: "sales_content_creation",
            shortName: "Sales Content Creation"
          }
        : proposal
    );
    await writeFile(proposalSetPath, `${JSON.stringify(proposalSet, null, 2)}\n`);

    const blockedDepartmentPath = path.join(projectRoot, ".loopgraph", "generated", "hermes", "sales");
    await mkdir(path.dirname(blockedDepartmentPath), { recursive: true });
    await writeFile(blockedDepartmentPath, "not a directory");

    const result = await materializeAcceptedLoopDesignProposals({
      projectRoot,
      designRunId: design.designRun.id,
      acceptedProposalIds: ["proposal_marketing_ads", "proposal_marketing_content_creation"],
      acceptedBy: "user",
      now: new Date("2026-07-21T12:20:00.000Z")
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Atomic materialization failed before commit");
    expect(result.materializedLoops).toEqual([]);
    expect((await readLoopgraphWorkspace(projectRoot)).registeredSpecs).toEqual([]);

    await expect(access(path.join(
      projectRoot,
      ".loopgraph",
      "generated",
      "hermes",
      "marketing",
      "marketing_ads",
      "loopgraph.yaml"
    ))).rejects.toThrow();
    await expect(access(path.join(
      projectRoot,
      ".loopgraph",
      "generated",
      "hermes",
      "marketing",
      "marketing_ads",
      "fixtures",
      "happy-path.json"
    ))).rejects.toThrow();
    await expect(access(path.join(
      projectRoot,
      ".loopgraph",
      "discovery",
      "materializations",
      "staging",
      result.materializationId
    ))).rejects.toThrow();
  });
});

class RecordingDistributedLoopSpecStore
implements LoopSpecRegistryStore {
  readonly persistence = "distributed" as const;
  readonly commits: LoopSpecMaterializationCommitInput[] = [];
  private artifacts: StoredLoopSpecArtifact[] = [];

  async getWorkspace(projectRoot: string) {
    const registeredSpecs = this.artifacts.map((artifact) => artifact.entry);
    return {
      workspace: {
        version: 1 as const,
        schemaVersion: "workspace/v1alpha1" as const,
        projectRoot,
        projectRootId: "project_hosted",
        displayName: "Hosted project",
        demoCatalogEnabled: false,
        registeredSpecs,
        initializedAt: "2026-07-21T12:00:00.000Z",
        updatedAt:
          this.commits.at(-1)?.committedAt ??
          "2026-07-21T12:00:00.000Z"
      },
      revision: this.commits.length
    };
  }

  async listActiveLoopSpecs() {
    return this.artifacts;
  }

  async getActiveLoopSpec(_projectRoot: string, loopId: string) {
    return this.artifacts.find((artifact) => artifact.loopId === loopId);
  }

  async commitMaterializationAtomically(
    input: LoopSpecMaterializationCommitInput
  ) {
    this.commits.push(input);
    this.artifacts = input.artifacts.map((artifact) => {
      const sourceRef =
        `registry://${artifact.loopId}/${artifact.versionHash}`;
      return {
        ...artifact,
        entry: {
          ...artifact.entry,
          path: sourceRef
        },
        sourceRef
      };
    });
    const { workspace } = await this.getWorkspace(input.projectRoot);
    return {
      workspace,
      workspaceRevision: this.commits.length,
      artifacts: this.artifacts,
      discoverySession: input.discoverySessionTransition?.session,
      created: true,
      commitRef: `registry-commit://${input.commitId}`
    };
  }
}

async function createCompletedMarketingDiscoverySession(): Promise<string> {
  const projectRoot = await temporaryProjectRoot();
  const started = await startHermesDiscoverySession({
    projectRoot,
    sessionId: "session_materialize",
    companyId: "company_1",
    companyName: "Acme"
  });
  let session = await selectDiscoveryDepartments({
    projectRoot,
    sessionId: started.id,
    departments: ["marketing"],
    expectedRevision: 0
  });

  for (const item of [
    {
      bundleId: "current_stack_sources",
      answers: {
        systems: ["Google Ads", "HubSpot", "Notion"],
        source_of_truth: "HubSpot defines qualified leads and customers.",
        event_sources_subjects: "Hermes receives Google Ads campaign anomaly events keyed by campaign ID.",
        safe_reads: ["campaign performance", "qualified lead status", "approved briefs"],
        manual_fallbacks: ["weekly ads CSV", "approved briefs Markdown folder"],
        existing_automations: []
      }
    },
    {
      bundleId: "biggest_recurring_problem",
      answers: {
        processes: ["paid ads review", "content draft creation"],
        trigger_or_cadence: "Campaign anomalies and approved content briefs.",
        problem_signal: "Campaign spend rises while qualified customer conversion drops.",
        required_evidence: ["spend delta", "cost per qualified customer delta", "qualified conversion delta"],
        weekly_volume: 12,
        current_owner: "Growth lead",
        current_steps: ["collect campaign metrics", "compare to qualified lead quality", "draft content from approved evidence"],
        pain_type_severity: "Manual context gathering and slow draft review are high severity.",
        baseline: "6 hours per week"
      }
    },
    {
      bundleId: "automation_boundaries",
      answers: {
        desired_automation_mode: "monitor, recommend, and draft",
        candidate_outputs_actions: ["campaign recommendation", "content draft", "review packet"],
        read_write_boundary: "Read data and write drafts only; no publishing or spend changes without approval.",
        customer_facing_status: true,
        forbidden_actions: ["no unapproved budget changes", "no unapproved publishing", "no unsupported claims"],
        ignore_conditions: ["test campaigns and already-resolved anomalies"],
        ambiguity_policy: "request_human",
        fanout_policy: "independent_only"
      }
    },
    {
      bundleId: "ideal_outcome_proof",
      answers: {
        primary_outcome_metric: "cost per qualified customer",
        leading_indicator: "qualified lead rate",
        guardrail_metric: "lead quality and brand safety must not decline",
        baseline_target: "Reduce review prep from 6 hours to 2 hours per week.",
        verification_rules: ["recommendations cite source metrics", "draft claims cite approved evidence"],
        completion_signal: ["approved recommendation recorded", "draft accepted by reviewer"],
        failure_signal: ["review rejected", "required evidence missing after timeout"]
      }
    },
    {
      bundleId: "ownership_rollout",
      answers: {
        loop_owner_role: "Growth lead",
        reviewer_roles: ["Marketing lead", "Finance reviewer"],
        escalation_conditions: ["spend change above threshold", "unsupported content claim", "low confidence"],
        initial_autonomy_level: "shadow",
        repeat_policy: "append_evidence",
        urgency_priority: "Campaign spend anomalies above threshold win over routine content work.",
        pilot_scope: "two campaigns and one content channel",
        management_summary: "weekly learning summary"
      }
    }
  ]) {
    session = await submitDiscoveryAnswers({
      projectRoot,
      sessionId: started.id,
      bundleId: item.bundleId,
      answers: item.answers,
      expectedRevision: session.revision
    });
  }

  return projectRoot;
}
