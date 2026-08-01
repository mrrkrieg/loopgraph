import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  BusinessDiscoverySessionSchema,
  contentHash,
  designRunSchema,
  evidenceGapSetSchema,
  loopDesignContextSchema,
  loopDesignProposalSetSchema,
  type BusinessDiscoverySession,
  type DesignRun,
  type EvidenceGapSet,
  type LoopDesignContext,
  type LoopDesignProposalSet
} from "../core";
import { getLoopgraphRoot } from "./storage-resolver";

export type DiscoverySessionCreateResult = {
  session: BusinessDiscoverySession;
  created: boolean;
};

export type DiscoverySessionUpdateInput = {
  sessionId: string;
  expectedRevision: number;
  session: BusinessDiscoverySession;
};

export type DesignSubmissionCreateInput = {
  context: LoopDesignContext;
  designRun: DesignRun;
  proposalSet: LoopDesignProposalSet;
};

export type DesignSubmissionCreateResult = {
  context: LoopDesignContext;
  designRun: DesignRun;
  proposalSet: LoopDesignProposalSet;
  session: BusinessDiscoverySession;
  created: boolean;
  contextRef: string;
  designRunRef: string;
  proposalSetRef: string;
};

/**
 * Canonical persistence boundary for discovery evidence and immutable design
 * artifacts. Local installations use FileDiscoveryDesignStore; hosted runtimes
 * inject a tenant-scoped distributed implementation.
 */
export interface DiscoveryDesignStore {
  readonly persistence: "file" | "distributed";
  createSessionAtomically(
    session: BusinessDiscoverySession
  ): Promise<DiscoverySessionCreateResult>;
  getSession(sessionId: string): Promise<BusinessDiscoverySession | undefined>;
  listSessions(): Promise<BusinessDiscoverySession[]>;
  updateSessionAtomically(
    input: DiscoverySessionUpdateInput
  ): Promise<BusinessDiscoverySession>;
  createDesignSubmissionAtomically(
    input: DesignSubmissionCreateInput
  ): Promise<DesignSubmissionCreateResult>;
  getDesignContext(designRunId: string): Promise<LoopDesignContext | undefined>;
  getDesignRun(designRunId: string): Promise<DesignRun | undefined>;
  getProposalSet(designRunId: string): Promise<LoopDesignProposalSet | undefined>;
  getEvidenceGapSet(sessionId: string): Promise<EvidenceGapSet | undefined>;
  putEvidenceGapSetAtomically(set: EvidenceGapSet): Promise<EvidenceGapSet>;
}

export class FileDiscoveryDesignStore implements DiscoveryDesignStore {
  readonly persistence = "file" as const;

  constructor(private readonly rootDir = getLoopgraphRoot()) {}

  async createSessionAtomically(
    session: BusinessDiscoverySession
  ): Promise<DiscoverySessionCreateResult> {
    const parsed = BusinessDiscoverySessionSchema.parse(session);
    return this.withLock(async () => {
      const existing = await this.getSession(parsed.id);
      if (existing) {
        if (contentHash(existing) !== contentHash(parsed)) {
          throw new Error(
            `Discovery session already exists with conflicting content: ${parsed.id}`
          );
        }
        return { session: existing, created: false };
      }
      if (parsed.revision !== 0) {
        throw new Error(
          `New discovery session must start at revision 0, found ${parsed.revision}`
        );
      }
      await writeJsonAtomic(this.sessionPath(parsed.id), parsed);
      return { session: parsed, created: true };
    });
  }

  async getSession(
    sessionId: string
  ): Promise<BusinessDiscoverySession | undefined> {
    return readOptionalJson(
      this.sessionPath(sessionId),
      BusinessDiscoverySessionSchema.parse
    );
  }

  async listSessions(): Promise<BusinessDiscoverySession[]> {
    let files: string[];
    try {
      files = await readdir(this.sessionsRoot());
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
    const sessions = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) =>
          readOptionalJson(
            path.join(this.sessionsRoot(), file),
            BusinessDiscoverySessionSchema.parse
          )
        )
    );
    return sessions
      .filter(
        (session): session is BusinessDiscoverySession => session !== undefined
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id)
      );
  }

  async updateSessionAtomically(
    input: DiscoverySessionUpdateInput
  ): Promise<BusinessDiscoverySession> {
    const parsed = BusinessDiscoverySessionSchema.parse(input.session);
    return this.withLock(async () => {
      const current = await this.getSession(input.sessionId);
      if (!current) {
        throw new Error(`Discovery session not found: ${input.sessionId}`);
      }
      assertSessionUpdate(current, parsed, input.expectedRevision);
      await writeJsonAtomic(this.sessionPath(parsed.id), parsed);
      return parsed;
    });
  }

  async createDesignSubmissionAtomically(
    input: DesignSubmissionCreateInput
  ): Promise<DesignSubmissionCreateResult> {
    const context = loopDesignContextSchema.parse(input.context);
    const designRun = designRunSchema.parse(input.designRun);
    const proposalSet = loopDesignProposalSetSchema.parse(input.proposalSet);
    assertDesignSubmission(context, designRun, proposalSet);

    return this.withLock(async () => {
      const session = await this.getSession(designRun.sessionId);
      if (!session) {
        throw new Error(
          `Discovery session not found for design run: ${designRun.sessionId}`
        );
      }
      if (session.companyId !== context.companyId) {
        throw new Error(
          "Design submission company identity does not match its discovery session"
        );
      }

      const existingRun = await this.getDesignRun(designRun.id);
      const existingContext = await this.getDesignContext(designRun.id);
      const existingProposalSet = await this.getProposalSet(designRun.id);
      if (existingRun) {
        assertSameDesignSubmission({
          expected: { context, designRun, proposalSet },
          actual: {
            context: existingContext,
            designRun: existingRun,
            proposalSet: existingProposalSet
          }
        });
      }

      const createdFiles: string[] = [];
      try {
        if (!existingContext) {
          await writeJsonAtomic(this.contextPath(designRun.id), context);
          createdFiles.push(this.contextPath(designRun.id));
        }
        if (!existingRun) {
          await writeJsonAtomic(this.designRunPath(designRun.id), designRun);
          createdFiles.push(this.designRunPath(designRun.id));
        }
        if (!existingProposalSet) {
          await writeJsonAtomic(
            this.proposalSetPath(designRun.id),
            proposalSet
          );
          createdFiles.push(this.proposalSetPath(designRun.id));
        }

        const nextSession = session.designRunIds.includes(designRun.id)
          ? session
          : BusinessDiscoverySessionSchema.parse({
              ...session,
              designRunIds: [...session.designRunIds, designRun.id],
              activeStage: "proposal_review",
              revision: session.revision + 1,
              updatedAt: designRun.completedAt ?? designRun.startedAt
            });
        if (nextSession !== session) {
          await writeJsonAtomic(this.sessionPath(session.id), nextSession);
        }

        return {
          context: existingContext ?? context,
          designRun: existingRun ?? designRun,
          proposalSet: existingProposalSet ?? proposalSet,
          session: nextSession,
          created: !existingRun,
          contextRef: this.contextPath(designRun.id),
          designRunRef: this.designRunPath(designRun.id),
          proposalSetRef: this.proposalSetPath(designRun.id)
        };
      } catch (error) {
        await Promise.all(
          createdFiles.map((filePath) =>
            unlink(filePath).catch(() => undefined)
          )
        );
        throw error;
      }
    });
  }

  async getDesignContext(
    designRunId: string
  ): Promise<LoopDesignContext | undefined> {
    return readOptionalJson(
      this.contextPath(designRunId),
      loopDesignContextSchema.parse
    );
  }

  async getDesignRun(designRunId: string): Promise<DesignRun | undefined> {
    return readOptionalJson(
      this.designRunPath(designRunId),
      designRunSchema.parse
    );
  }

  async getProposalSet(
    designRunId: string
  ): Promise<LoopDesignProposalSet | undefined> {
    return readOptionalJson(
      this.proposalSetPath(designRunId),
      loopDesignProposalSetSchema.parse
    );
  }

  async getEvidenceGapSet(
    sessionId: string
  ): Promise<EvidenceGapSet | undefined> {
    return readOptionalJson(
      this.evidenceGapSetPath(sessionId),
      evidenceGapSetSchema.parse
    );
  }

  async putEvidenceGapSetAtomically(set: EvidenceGapSet): Promise<EvidenceGapSet> {
    const parsed = evidenceGapSetSchema.parse(set);
    return this.withLock(async () => {
      const session = await this.getSession(parsed.sessionId);
      if (!session) {
        throw new Error(
          `Discovery session not found for evidence gaps: ${parsed.sessionId}`
        );
      }
      if (
        parsed.companyId !== session.companyId ||
        parsed.revision > session.revision
      ) {
        throw new Error("Evidence gap set does not match its discovery session");
      }
      const existing = await this.getEvidenceGapSet(parsed.sessionId);
      if (existing && existing.revision > parsed.revision) return existing;
      await writeJsonAtomic(this.evidenceGapSetPath(parsed.sessionId), parsed);
      return parsed;
    });
  }

  private sessionsRoot(): string {
    return path.join(this.rootDir, "discovery", "sessions");
  }

  private sessionPath(sessionId: string): string {
    return path.join(this.sessionsRoot(), `${safeRecordId(sessionId)}.json`);
  }

  private contextPath(designRunId: string): string {
    return path.join(
      this.rootDir,
      "discovery",
      "design-contexts",
      `${safeRecordId(designRunId)}.json`
    );
  }

  private designRunPath(designRunId: string): string {
    return path.join(
      this.rootDir,
      "discovery",
      "design-runs",
      `${safeRecordId(designRunId)}.json`
    );
  }

  private proposalSetPath(designRunId: string): string {
    return path.join(
      this.rootDir,
      "discovery",
      "proposals",
      `${safeRecordId(designRunId)}.json`
    );
  }

  private evidenceGapSetPath(sessionId: string): string {
    return path.join(
      this.rootDir,
      "discovery",
      "evidence-gaps",
      `${safeRecordId(sessionId)}.json`
    );
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = path.join(
      this.rootDir,
      "discovery",
      ".discovery-design.lock"
    );
    await mkdir(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          return await operation();
        } finally {
          await handle.close();
          await unlink(lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        await delay(Math.min(100, 5 + attempt * 2));
      }
    }
    throw new Error("Timed out waiting for discovery design store lock");
  }
}

function assertSessionUpdate(
  current: BusinessDiscoverySession,
  next: BusinessDiscoverySession,
  expectedRevision: number
): void {
  if (current.revision !== expectedRevision) {
    throw new Error(
      `Discovery session revision mismatch: expected ${expectedRevision}, found ${current.revision}`
    );
  }
  if (next.id !== current.id) {
    throw new Error("Discovery session identity cannot change");
  }
  if (next.companyId !== current.companyId || next.createdAt !== current.createdAt) {
    throw new Error("Discovery session ownership cannot change");
  }
  if (next.revision !== expectedRevision + 1) {
    throw new Error(
      `Discovery session update must advance revision to ${expectedRevision + 1}`
    );
  }
}

function assertDesignSubmission(
  context: LoopDesignContext,
  designRun: DesignRun,
  proposalSet: LoopDesignProposalSet
): void {
  if (
    context.sessionId !== designRun.sessionId ||
    proposalSet.sessionId !== designRun.sessionId
  ) {
    throw new Error("Design submission session identity does not match");
  }
  if (
    context.departmentType !== designRun.departmentType ||
    proposalSet.departmentType !== designRun.departmentType
  ) {
    throw new Error("Design submission department identity does not match");
  }
  if (context.contextHash !== designRun.inputHash) {
    throw new Error("Design run input hash does not match its context");
  }
  const proposalHash = `out_${contentHash(proposalSet)}`;
  if (designRun.outputHash !== proposalHash) {
    throw new Error("Design run output hash does not match its proposal set");
  }
}

function assertSameDesignSubmission(input: {
  expected: {
    context: LoopDesignContext;
    designRun: DesignRun;
    proposalSet: LoopDesignProposalSet;
  };
  actual: {
    context?: LoopDesignContext;
    designRun: DesignRun;
    proposalSet?: LoopDesignProposalSet;
  };
}): void {
  if (
    input.actual.designRun.inputHash !== input.expected.designRun.inputHash ||
    input.actual.designRun.outputHash !== input.expected.designRun.outputHash
  ) {
    throw new Error("Idempotent design submission resolved to conflicting content");
  }
  if (
    input.actual.context &&
    contentHash(input.actual.context) !== contentHash(input.expected.context)
  ) {
    throw new Error("Stored design context conflicts with the submitted context");
  }
  if (
    input.actual.proposalSet &&
    contentHash(input.actual.proposalSet) !==
      contentHash(input.expected.proposalSet)
  ) {
    throw new Error("Stored proposal set conflicts with the submitted proposal set");
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporaryPath, filePath);
}

async function readOptionalJson<T>(
  filePath: string,
  parse: (value: unknown) => T
): Promise<T | undefined> {
  try {
    return parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

function safeRecordId(value: string): string {
  if (
    !value ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Discovery design record ID is invalid");
  }
  return encodeURIComponent(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
