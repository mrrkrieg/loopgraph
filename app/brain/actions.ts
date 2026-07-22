"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveLoopgraphProjectRoot } from "../../lib/loopgraph-runtime/storage-resolver";
import {
  simulateLoopForHermes,
  validateLoopForHermes
} from "loopgraph/runtime";

export async function validateBrainLoopAction(formData: FormData) {
  const loopId = requiredFormString(formData, "loopId");
  const result = await validateLoopForHermes({
    projectRoot: getActiveLoopgraphProjectRoot(),
    loopId
  });

  if (!result.valid) {
    throw new Error(`Loop validation failed:\n- ${result.errors.join("\n- ")}`);
  }

  revalidateBrainLoopPaths(loopId);
  redirect(`/loops/${encodeURIComponent(result.loopId ?? loopId)}`);
}

export async function simulateBrainLoopFixtureAction(formData: FormData) {
  const loopId = requiredFormString(formData, "loopId");
  const fixtureId = requiredFormString(formData, "fixtureId");
  const projectRoot = getActiveLoopgraphProjectRoot();
  const fixturePath = await resolveFixturePath({
    projectRoot,
    loopId,
    fixtureId
  });
  const result = await simulateLoopForHermes({
    projectRoot,
    loopId,
    fixturePath
  });

  if (!result.valid) {
    throw new Error(`Loop simulation failed:\n- ${result.errors.join("\n- ")}`);
  }
  if (!result.runId) {
    throw new Error("Loop simulation did not return a run ID.");
  }

  revalidateBrainLoopPaths(loopId);
  if (result.reviewRequired) {
    redirect(`/loops/${encodeURIComponent(loopId)}/reviews?runId=${encodeURIComponent(result.runId)}`);
  }
  redirect(`/loops/${encodeURIComponent(loopId)}/runs/${encodeURIComponent(result.runId)}`);
}

export async function simulateBrainLoopManualEventAction(formData: FormData) {
  const loopId = requiredFormString(formData, "loopId");
  const fixture = parseManualFixtureJson(requiredFormString(formData, "fixtureJson"));
  const projectRoot = getActiveLoopgraphProjectRoot();
  const result = await simulateLoopForHermes({
    projectRoot,
    loopId,
    fixture
  });

  if (!result.valid) {
    throw new Error(`Loop simulation failed:\n- ${result.errors.join("\n- ")}`);
  }
  if (!result.runId) {
    throw new Error("Loop simulation did not return a run ID.");
  }

  revalidateBrainLoopPaths(loopId);
  if (result.reviewRequired) {
    redirect(`/loops/${encodeURIComponent(loopId)}/reviews?runId=${encodeURIComponent(result.runId)}`);
  }
  redirect(`/loops/${encodeURIComponent(loopId)}/runs/${encodeURIComponent(result.runId)}`);
}

async function resolveFixturePath(input: {
  projectRoot: string;
  loopId: string;
  fixtureId: string;
}): Promise<string> {
  const validation = await validateLoopForHermes({
    projectRoot: input.projectRoot,
    loopId: input.loopId
  });

  if (!validation.valid) {
    throw new Error(`Loop validation failed:\n- ${validation.errors.join("\n- ")}`);
  }

  const fixture = validation.fixtures.find((item) => item.id === input.fixtureId);
  if (!fixture) {
    throw new Error(`Fixture not found for ${input.loopId}: ${input.fixtureId}`);
  }

  return path.isAbsolute(fixture.path)
    ? fixture.path
    : path.join(path.dirname(validation.specPath), fixture.path);
}

function revalidateBrainLoopPaths(loopId: string): void {
  revalidatePath("/brain");
  revalidatePath("/topology");
  revalidatePath(`/loops/${loopId}`);
  revalidatePath(`/loops/${loopId}/runs`);
  revalidatePath(`/loops/${loopId}/reviews`);
}

function requiredFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value.trim();
}

function parseManualFixtureJson(value: string): { eventId: string; simulatedAt: string } & Record<string, unknown> {
  if (value.length > 20000) {
    throw new Error("Manual simulation JSON is too large. Keep local test events under 20KB.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Manual simulation JSON must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Manual simulation JSON must be an object.");
  }
  if (typeof parsed.eventId !== "string" || parsed.eventId.trim().length === 0) {
    throw new Error("Manual simulation JSON must include a non-empty eventId string.");
  }
  if (typeof parsed.simulatedAt !== "string" || parsed.simulatedAt.trim().length === 0) {
    throw new Error("Manual simulation JSON must include a non-empty simulatedAt string.");
  }

  const secretPath = findSecretLikeKey(parsed);
  if (secretPath) {
    throw new Error(`Manual simulation JSON appears to contain a secret-like field: ${secretPath}. Use redacted synthetic data only.`);
  }

  return {
    ...parsed,
    eventId: parsed.eventId.trim(),
    simulatedAt: parsed.simulatedAt.trim()
  };
}

function findSecretLikeKey(value: unknown, pathPrefix = "", depth = 0): string | undefined {
  if (depth > 5) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretLikeKey(value[index], `${pathPrefix}[${index}]`, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (isSecretLikeKey(key)) {
      return currentPath;
    }
    const found = findSecretLikeKey(nestedValue, currentPath, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "apikey",
    "token",
    "secret",
    "password",
    "passwd",
    "privatekey",
    "authorization",
    "authheader",
    "credential",
    "clientsecret"
  ].some((needle) => normalized.includes(needle));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
