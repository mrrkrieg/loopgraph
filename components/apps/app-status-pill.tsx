import type { AppInstallationState, AppReadiness } from "loopgraph/core";

export function AppStatusPill({
  state,
  readiness
}: {
  state?: AppInstallationState;
  readiness?: AppReadiness["state"];
}) {
  const value = readiness ?? state ?? "available";
  const tone = value === "production_ready" || value === "live" || value === "ready_for_recommend"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : value === "blocked" || value === "broken" || value === "revoked"
      ? "border-red-200 bg-red-50 text-red-800"
      : value === "available"
        ? "border-stone-200 bg-stone-50 text-stone-700"
        : "border-orange-200 bg-orange-50 text-orange-800";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}
