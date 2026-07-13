import type { AgentRunOutput } from "../core/evidence";
import { agentRunOutputSchema } from "../core/evidence";
import type { AssessmentProvider, AssessmentProviderInput } from "../sdk/providers";
import { generateAssessment as generateFixtureAssessment } from "./fixture-provider";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Strip optional markdown fences before JSON.parse. */
export function parseModelJson(text: string): unknown {
  let candidate = text.trim();
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
  }
  return JSON.parse(candidate);
}

function agentRunOutputJsonSchema(): Record<string, unknown> {
  const full = zodToJsonSchema(agentRunOutputSchema, {
    name: "AgentRunOutput",
    $refStrategy: "none"
  }) as { definitions?: Record<string, Record<string, unknown>> };
  const schema = full.definitions?.AgentRunOutput;
  if (!schema) {
    throw new Error("Failed to derive AgentRunOutput JSON schema");
  }

  return schema;
}

function normalizeAssessmentOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const output = { ...(raw as Record<string, unknown>) };
  const verificationRequest =
    output.verificationRequest && typeof output.verificationRequest === "object"
      ? { ...(output.verificationRequest as Record<string, unknown>) }
      : {};

  if (verificationRequest.required === undefined) {
    verificationRequest.required = false;
  }
  if (verificationRequest.checks === undefined) {
    verificationRequest.checks = ["evidence", "policy"];
  }

  output.verificationRequest = verificationRequest;
  if (output.escalationRequest === undefined) {
    output.escalationRequest = { required: false };
  }

  return output;
}

function buildAssessmentPrompt(input: AssessmentProviderInput): string {
  const toolKeys = input.spec.tools.map((tool) => tool.key).join(", ");
  const outputSchema = JSON.stringify(input.spec.output.schema, null, 2);

  return [
    "You are a loop assessment agent for Loopgraph.",
    "Return ONLY a JSON object matching the output schema below. Do not execute tools.",
    "Required top-level fields: decisionSummary, assumptions, proposedActions, evidence, policyInputs, verificationRequest.",
    "Include escalationRequest when policy requires escalation; otherwise set escalationRequest.required to false.",
    `Allowed proposedActions.toolKey values: ${toolKeys}`,
    "",
    "Output schema:",
    outputSchema,
    "",
    "Compiled context:",
    input.context.compiledPrompt ?? "(none)",
    input.triggerPayload ? `Trigger payload:\n${JSON.stringify(input.triggerPayload, null, 2)}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export class FixtureAssessmentProvider implements AssessmentProvider {
  id = "fixture";

  async generate(input: AssessmentProviderInput): Promise<AgentRunOutput> {
    if (!input.fixture) {
      throw new Error("FixtureAssessmentProvider requires a fixture");
    }
    return generateFixtureAssessment({
      spec: input.spec,
      fixture: input.fixture,
      context: input.context
    });
  }
}

export class OpenAIAssessmentProvider implements AssessmentProvider {
  id = "openai";

  async generate(input: AssessmentProviderInput): Promise<AgentRunOutput> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAIAssessmentProvider");
    }

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const prompt = buildAssessmentPrompt(input);

    const response = await client.responses.create({
      model: process.env.LOOPGRAPH_OPENAI_MODEL ?? "gpt-4.1-mini",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "agent_run_output",
          strict: false,
          schema: agentRunOutputJsonSchema()
        }
      }
    });

    const text = response.output_text;
    const parsed = agentRunOutputSchema.parse(normalizeAssessmentOutput(parseModelJson(text)));
    return parsed;
  }
}

export function getAssessmentProvider(mode: "simulate" | "execute" = "simulate"): AssessmentProvider {
  const provider = process.env.LOOPGRAPH_ASSESSMENT_PROVIDER ?? (mode === "simulate" ? "fixture" : "openai");
  if (provider === "openai") {
    return new OpenAIAssessmentProvider();
  }
  return new FixtureAssessmentProvider();
}
