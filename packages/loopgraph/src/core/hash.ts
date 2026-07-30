import { createHash } from "node:crypto";

export function contentHash(value: unknown): string {
  return contentDigest(value).slice(0, 16);
}

export function contentDigest(value: unknown): string {
  const normalized =
    value === undefined || value === null
      ? String(value)
      : typeof value === "string"
        ? value
        : stableStringify(value);
  return createHash("sha256").update(normalized).digest("hex");
}

export function idempotencyKey(input: {
  loopSpecVersion: string;
  triggerSource: string;
  sourceEventId: string;
}): string {
  return contentHash({
    loopSpecVersion: input.loopSpecVersion,
    triggerSource: input.triggerSource,
    sourceEventId: input.sourceEventId
  });
}

export function loopSpecHash(spec: unknown): string {
  return contentHash(spec);
}

export function loopSpecVersionHash(spec: unknown): string {
  return contentDigest(spec);
}

export function runId(input: { loopSpecHash: string; idempotencyKey: string }): string {
  return `run_${contentHash(input)}`;
}

export function actionFingerprint(payload: unknown): string {
  return contentHash(payload);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
