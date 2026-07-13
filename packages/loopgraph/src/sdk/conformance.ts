import type { IntegrationAdapter } from "./adapters";

const requiredMethods: Array<keyof IntegrationAdapter> = [
  "id",
  "name",
  "version",
  "getConfigSchema",
  "getAuthSchema",
  "listVariables",
  "listActions",
  "listSignals",
  "readVariable",
  "prepareAction",
  "commitPreparedAction",
  "healthCheck"
];

export async function runAdapterConformance(adapter: IntegrationAdapter): Promise<string[]> {
  const errors: string[] = [];
  for (const method of requiredMethods) {
    if (typeof adapter[method] !== "function" && typeof adapter[method] !== "string") {
      errors.push(`Missing adapter property/method: ${method}`);
    }
  }

  try {
    adapter.getConfigSchema();
    adapter.getAuthSchema();
    adapter.listVariables();
    adapter.listActions();
    adapter.listSignals();
    await adapter.healthCheck();
    const prepared = await adapter.prepareAction({ toolKey: adapter.listActions()[0]?.key ?? "noop", payload: { ok: true } });
    if (!prepared.fingerprint) errors.push("prepareAction must return fingerprint");
    await adapter.commitPreparedAction({ preparedAction: prepared, approvedFingerprints: [prepared.fingerprint] });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return errors;
}
