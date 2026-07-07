import type { AgentRunOutput } from "../core/evidence";
import type { ContextSnapshot } from "../core/context";
import type { LoopSpec } from "../core/loop-spec";

export type AssessmentFixture = Record<string, unknown> & {
  eventId: string;
  simulatedAt: string;
};

export type AssessmentProviderInput = {
  spec: LoopSpec;
  context: ContextSnapshot;
  fixture?: AssessmentFixture;
  triggerPayload?: Record<string, unknown>;
};

export interface AssessmentProvider {
  id: string;
  generate(input: AssessmentProviderInput): Promise<AgentRunOutput>;
}
