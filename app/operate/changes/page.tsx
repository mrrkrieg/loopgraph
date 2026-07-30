import Link from "next/link";
import { EmptyOperatingState } from "@/components/operate/empty-operating-state";
import { formatOperatingDate } from "@/components/operate/format";
import { OperateNav } from "@/components/operate/operate-nav";
import { OperatingModeNote } from "@/components/operate/operating-mode-note";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatusPill } from "@/components/status-pill";
import { getOperatingViewData } from "@/lib/loopgraph-runtime/operating-view-data";

export default async function ChangeReviewPage() {
  const data = await getOperatingViewData();
  const awaitingDecision = data.changes.filter((change) => change.status === "Proposed").length;
  const approved = data.changes.filter((change) => change.status === "Approved").length;
  const applied = data.changes.filter((change) => change.status === "Applied").length;

  return (
    <>
      <PageHeader
        eyebrow="Operate"
        title="Graph change review"
        description="Inspect the exact add, update, split, merge, or retire operation before it changes the company graph. Approval receipts and transaction results stay attached to the proposal."
        action={
          <Link className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink" href="/brain">
            Open company graph
          </Link>
        }
      />
      <OperateNav />
      <OperatingModeNote mode={data.mode} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Changes" value={data.changes.length} note="Exact semantic operations" />
        <MetricCard label="Awaiting decision" value={awaitingDecision} note="No approval receipt yet" />
        <MetricCard label="Approved" value={approved} note="Ready for governed application" />
        <MetricCard label="Applied" value={applied} note="Committed graph transactions" />
      </div>

      <div className="mt-6">
        {data.changes.length === 0 ? (
          <EmptyOperatingState
            title="No graph changes are waiting"
            description="A clean local workspace has no proposed changes. Hermes first needs a qualified opportunity and enough discovery evidence to produce an exact, reviewable graph operation."
            command="loopgraph opportunities scan"
            actionHref="/operate/opportunities"
            actionLabel="View opportunities"
          />
        ) : (
          <div className="space-y-4">
            {data.changes.map((change) => (
              <SectionCard
                key={change.id}
                title={change.title}
                description={`${change.department} · Version ${change.version} · Updated ${formatOperatingDate(change.updatedAt)}`}
              >
                <div className="grid gap-5 lg:grid-cols-[1fr_0.55fr]">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill>{change.operation}</StatusPill>
                      <StatusPill>{change.status}</StatusPill>
                      {change.requiresExplicitApproval ? <StatusPill>Explicit approval</StatusPill> : null}
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="rounded-md border border-line bg-paper p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Why change</div>
                        <p className="mt-2 text-sm leading-6 text-ink/70">{change.rationale}</p>
                      </div>
                      <div className="rounded-md border border-line bg-paper p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Expected outcome</div>
                        <p className="mt-2 text-sm leading-6 text-ink/70">{change.expectedOutcome}</p>
                      </div>
                    </div>
                  </div>
                  <dl className="grid content-start gap-3 text-sm">
                    <ReceiptRow label="Evidence" value={`${change.evidenceCount} references`} />
                    <ReceiptRow
                      label="Decision"
                      value={change.approvalDecision
                        ? `${change.approvalDecision}${change.approvalActor ? ` by ${change.approvalActor}` : ""}`
                        : "Waiting for accountable owner"}
                    />
                    <ReceiptRow
                      label="Transaction"
                      value={change.transactionStatus
                        ? `${change.transactionStatus} · ${change.transactionId}`
                        : "Not applied"}
                    />
                  </dl>
                </div>
              </SectionCard>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-3">
      <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</dt>
      <dd className="mt-1 break-words font-medium text-ink/75">{value}</dd>
    </div>
  );
}
