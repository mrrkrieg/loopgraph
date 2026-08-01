import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BusinessDiscoverySessionSchema,
  evidenceGapSetSchema
} from "../core";
import { FileDiscoveryDesignStore } from "./discovery-design-store";

describe("File discovery design store", () => {
  it("creates sessions idempotently and fences concurrent revisions", async () => {
    const store = await temporaryStore();
    const session = discoverySession();

    await expect(store.createSessionAtomically(session)).resolves.toEqual({
      session,
      created: true
    });
    await expect(
      store.createSessionAtomically(session)
    ).resolves.toEqual({
      session,
      created: false
    });
    await expect(
      store.createSessionAtomically(
        BusinessDiscoverySessionSchema.parse({
          ...session,
          companyProfile: {
            ...session.companyProfile!,
            name: "A conflicting request must not reuse the existing session"
          }
        })
      )
    ).rejects.toThrow("already exists with conflicting content");

    const next = BusinessDiscoverySessionSchema.parse({
      ...session,
      revision: 1,
      activeStage: "department_selection",
      updatedAt: "2026-07-30T12:01:00.000Z"
    });
    await expect(
      store.updateSessionAtomically({
        sessionId: session.id,
        expectedRevision: 0,
        session: next
      })
    ).resolves.toEqual(next);
    await expect(
      store.updateSessionAtomically({
        sessionId: session.id,
        expectedRevision: 0,
        session: next
      })
    ).rejects.toThrow("expected 0, found 1");
  });

  it("keeps evidence-gap derivations monotonic by session revision", async () => {
    const store = await temporaryStore();
    const session = discoverySession();
    await store.createSessionAtomically(session);
    const next = BusinessDiscoverySessionSchema.parse({
      ...session,
      revision: 1,
      updatedAt: "2026-07-30T12:01:00.000Z"
    });
    await store.updateSessionAtomically({
      sessionId: session.id,
      expectedRevision: 0,
      session: next
    });
    const revisionOne = evidenceGapSetSchema.parse({
      sessionId: session.id,
      companyId: session.companyId,
      revision: 1,
      generatedAt: "2026-07-30T12:01:00.000Z",
      gaps: []
    });
    const revisionZero = evidenceGapSetSchema.parse({
      ...revisionOne,
      revision: 0,
      generatedAt: "2026-07-30T12:00:30.000Z"
    });

    await expect(store.putEvidenceGapSetAtomically(revisionOne)).resolves.toEqual(
      revisionOne
    );
    await expect(store.putEvidenceGapSetAtomically(revisionZero)).resolves.toEqual(
      revisionOne
    );
    await expect(store.getEvidenceGapSet(session.id)).resolves.toEqual(
      revisionOne
    );
  });

  it("rejects identity and revision changes inside a session update", async () => {
    const store = await temporaryStore();
    const session = discoverySession();
    await store.createSessionAtomically(session);

    await expect(
      store.updateSessionAtomically({
        sessionId: session.id,
        expectedRevision: 0,
        session: BusinessDiscoverySessionSchema.parse({
          ...session,
          companyId: "company_other",
          revision: 1
        })
      })
    ).rejects.toThrow("ownership cannot change");
  });
});

async function temporaryStore(): Promise<FileDiscoveryDesignStore> {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), "loopgraph-discovery-design-store-")
  );
  return new FileDiscoveryDesignStore(path.join(projectRoot, ".loopgraph"));
}

function discoverySession() {
  return BusinessDiscoverySessionSchema.parse({
    id: "session_1",
    companyId: "company_1",
    status: "started",
    activeStage: "workspace",
    revision: 0,
    createdByActor: "api",
    lastActor: "api",
    companyProfile: {
      id: "company_1",
      departments: [],
      tools: [],
      bottlenecks: [],
      recurringWork: [],
      aiNeverActions: [],
      customerFacingOutputs: [],
      leadershipJudgment: []
    },
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z"
  });
}
