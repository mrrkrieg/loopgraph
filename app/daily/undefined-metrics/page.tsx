import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { getDiscoverySessionForView } from "../../discovery/view-data";

export default async function UndefinedMetricsPage() {
  const session = await getDiscoverySessionForView();
  return (
    <>
      <PageHeader eyebrow="Daily operating summary" title="Undefined Metrics" description="Metrics that cannot yet be trusted because integration, variables, formulas, baselines, or human definitions are missing." />
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
            <tr>
              <th className="px-4 py-3">Metric</th>
              <th className="px-4 py-3">Loop</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Required action</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {session.undefinedMetrics.map((metric) => {
              const recommendation = session.recommendedLoops.find((item) => item.id === metric.loopRecommendationId);
              const department = session.departmentProfiles.find((item) => item.id === metric.departmentId);
              return (
                <tr key={metric.id}>
                  <td className="px-4 py-3 font-medium">{metric.label}</td>
                  <td className="px-4 py-3">{recommendation?.name ?? metric.loopId ?? "Draft"}</td>
                  <td className="px-4 py-3">{department?.name ?? metric.departmentId}</td>
                  <td className="px-4 py-3"><StatusPill>{metric.reason}</StatusPill></td>
                  <td className="px-4 py-3">{metric.requiredAction}</td>
                  <td className="px-4 py-3">{metric.ownerRole ?? "Unassigned"}</td>
                  <td className="px-4 py-3"><StatusPill>{metric.status}</StatusPill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

