import React from "react";

const routingRows = [
  {
    eventType: "campaign_performance_drop",
    example: "CAC rises while qualified conversion falls",
    routedTo: "Marketing Department Loop",
    owner: "Growth lead",
    autonomy: "Draft for review"
  },
  {
    eventType: "customer_health_drop",
    example: "Strategic account risk score crosses threshold",
    routedTo: "Customer Success Department Loop",
    owner: "CS lead",
    autonomy: "Execute with approval"
  },
  {
    eventType: "release_blocker",
    example: "Launch dependency blocks a weekly milestone",
    routedTo: "Engineering Department Loop",
    owner: "Engineering lead",
    autonomy: "Recommend"
  },
  {
    eventType: "forecast_variance",
    example: "Plan and current forecast diverge",
    routedTo: "Ops / Finance Department Loop",
    owner: "Finance owner",
    autonomy: "Monitor"
  },
  {
    eventType: "candidate_pipeline_stall",
    example: "Hiring pipeline slows below plan",
    routedTo: "HR / Talent Department Loop",
    owner: "Talent lead",
    autonomy: "Draft for review"
  },
  {
    eventType: "policy_exception",
    example: "Workflow requests an exception to policy",
    routedTo: "Legal / Compliance Department Loop",
    owner: "Compliance owner",
    autonomy: "Human approval"
  }
];

export function EventRoutingTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-paper text-xs uppercase tracking-[0.14em] text-ink/50">
          <tr>
            <th className="px-4 py-3">Event Type</th>
            <th className="px-4 py-3">Example</th>
            <th className="px-4 py-3">Routed To</th>
            <th className="px-4 py-3">Human Owner</th>
            <th className="px-4 py-3">Autonomy Level</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {routingRows.map((row) => (
            <tr key={row.eventType}>
              <td className="px-4 py-3 font-semibold">{row.eventType}</td>
              <td className="px-4 py-3 text-ink/65">{row.example}</td>
              <td className="px-4 py-3">{row.routedTo}</td>
              <td className="px-4 py-3">{row.owner}</td>
              <td className="px-4 py-3">{row.autonomy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
