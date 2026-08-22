import React from "react";
import type { AppLifecycleOperation } from "loopgraph/runtime";

export function AppLifecycleRecoveryNotice({
  operations,
  compact = false
}: {
  operations: AppLifecycleOperation[];
  compact?: boolean;
}) {
  const unfinished = operations.filter((operation) => operation.status !== "completed");
  if (unfinished.length === 0) return null;
  return (
    <section
      aria-label="App lifecycle recovery required"
      className="rounded-xl border border-orange-300 bg-orange-50 p-4 text-orange-950 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">Recovery required</div>
          <h2 className="mt-1 text-lg font-semibold">
            {unfinished.length === 1 ? "One App operation needs to finish" : `${unfinished.length} App operations need to finish`}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-orange-900/75">
            Loopgraph preserved a secret-free recovery record and blocked conflicting lifecycle work. Resume the exact operation below; do not create a replacement plan while it is unfinished.
          </p>
        </div>
        <span className="rounded-full border border-orange-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em]">
          writes remain governed
        </span>
      </div>
      <div className={`mt-4 grid gap-3 ${compact ? "" : "lg:grid-cols-2"}`}>
        {unfinished.map((operation) => (
          <article className="rounded-lg border border-orange-200 bg-white p-4" key={operation.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold capitalize">{operation.action} {operation.appId}</div>
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-orange-800">
                {operation.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink/65">{recoveryInstruction(operation)}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Count label="Loops" value={operation.desired.loopIds.length} />
              <Count label="Mappings" value={operation.desired.fieldMappingIds.length} />
              <Count label="Context" value={operation.desired.companyContextKeys.length} />
            </div>
            {!compact ? (
              <details className="mt-3 text-xs text-ink/45">
                <summary className="cursor-pointer font-semibold">Recovery identity</summary>
                <dl className="mt-2 space-y-2 font-mono">
                  <div><dt className="inline font-sans font-semibold">Operation: </dt><dd className="inline break-all">{operation.id}</dd></div>
                  <div><dt className="inline font-sans font-semibold">Artifact: </dt><dd className="inline break-all">{operation.targetArtifactDigest}</dd></div>
                  {operation.uninstall ? <div><dt className="inline font-sans font-semibold">Reason digest: </dt><dd className="inline break-all">{operation.uninstall.reasonDigest}</dd></div> : null}
                  {operation.rollback ? <div><dt className="inline font-sans font-semibold">Source artifact: </dt><dd className="inline break-all">{operation.rollback.sourceArtifactDigest}</dd></div> : null}
                  <div><dt className="inline font-sans font-semibold">Updated: </dt><dd className="inline">{new Date(operation.updatedAt).toLocaleString()}</dd></div>
                </dl>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function recoveryInstruction(operation: AppLifecycleOperation): string {
  if (operation.action === "install") {
    return "Return to the Hermes, CLI, or browser session that submitted the approved plan and retry that exact plan. Its immutable digest may resume even if the original approval window has since expired.";
  }
  if (operation.action === "activate") {
    return `Retry only the recorded ${operation.activation?.targetMode.replace(/_/g, " ") ?? "activation"} transition with its exact approval receipt. Loopgraph will reconcile the owned LoopSpecs and consume that authority once; do not create a replacement approval.`;
  }
  if (operation.action === "pause" || operation.action === "resume") {
    const target = operation.rollout?.targetState.replace(/_/g, " ") ?? operation.action;
    return `Retry only the recorded ${operation.action} transition to ${target}. Loopgraph will reconcile the exact owned LoopSpec inventory and complete the App state change once; competing lifecycle work remains blocked.`;
  }
  if (operation.action === "rollback") {
    return "Open the installed App and retry rollback as the same actor. Loopgraph accepts only the recorded source installation revision and exact source or target LoopSpec topology; a replacement revision cannot be selected during recovery.";
  }
  return "Open the installed App and repeat uninstall as the same actor with the exact original reason. Loopgraph accepts only the recorded installation revision and exact pre-removal or post-removal LoopSpec topology; completed removals and ownership releases are not duplicated.";
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-paper px-2 py-2"><div className="font-semibold text-ink">{value}</div><div className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-ink/40">{label}</div></div>;
}
