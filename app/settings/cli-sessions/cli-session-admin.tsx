"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type {
  CliSessionAdminPage,
  CliSessionAdminStatus,
  CliSessionAdminView
} from "@/lib/auth/cli-session-admin";

const STATUS_LABEL: Record<CliSessionAdminStatus, string> = {
  active: "Active",
  refresh_required: "Refresh due",
  expired: "Expired",
  revoked: "Revoked"
};

const STATUS_CLASS: Record<CliSessionAdminStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  refresh_required: "border-amber-200 bg-amber-50 text-amber-900",
  expired: "border-slate-200 bg-slate-50 text-slate-600",
  revoked: "border-red-200 bg-red-50 text-red-800"
};

export function CliSessionAdmin({ initialPage }: { initialPage: CliSessionAdminPage }) {
  const [sessions, setSessions] = useState(initialPage.sessions);
  const [total, setTotal] = useState(initialPage.total);
  const [nextOffset, setNextOffset] = useState(initialPage.nextOffset);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const counts = useMemo(() => sessions.reduce<Record<CliSessionAdminStatus, number>>(
    (result, session) => ({ ...result, [session.status]: result[session.status] + 1 }),
    { active: 0, refresh_required: 0, expired: 0, revoked: 0 }
  ), [sessions]);
  const revocable = counts.active + counts.refresh_required;

  function loadMore() {
    if (nextOffset === undefined) return;
    startTransition(async () => {
      setMessage("");
      const response = await fetch(`/api/auth/cli-sessions?offset=${nextOffset}&limit=${initialPage.limit}`, {
        cache: "no-store"
      });
      const body = await response.json() as CliSessionAdminPage & { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Could not load more CLI sessions.");
        return;
      }
      setSessions((current) => [...current, ...body.sessions.filter(
        (session) => !current.some((existing) => existing.id === session.id)
      )]);
      setTotal(body.total);
      setNextOffset(body.nextOffset);
    });
  }

  function revoke(
    scope: "session" | "user" | "organization",
    target: { sessionId?: string; targetUserId?: string } = {}
  ) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setMessage("Enter a revocation reason first.");
      return;
    }
    if (scope === "organization" && !window.confirm(
      "Revoke every active human CLI session for this organization? Workload identities are not affected."
    )) return;
    startTransition(async () => {
      setMessage("");
      const response = await fetch("/api/auth/cli-sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, reason: cleanReason, ...target })
      });
      const body = await response.json() as {
        error?: string;
        revokedCount?: number;
        correlationId?: string;
      };
      if (!response.ok) {
        setMessage(body.error ?? "CLI session revocation failed.");
        return;
      }
      const revokedAt = new Date().toISOString();
      setSessions((current) => current.map((session) => {
        const matches = scope === "organization"
          || (scope === "session" && session.id === target.sessionId)
          || (scope === "user" && session.userId === target.targetUserId);
        return matches && session.status !== "expired" && session.status !== "revoked"
          ? { ...session, status: "revoked", revokedAt, updatedAt: revokedAt }
          : session;
      }));
      setReason("");
      setMessage(`${body.revokedCount ?? 0} CLI session${body.revokedCount === 1 ? "" : "s"} revoked. Audit receipt ${body.correlationId ?? "recorded"}.`);
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active" value={counts.active} />
        <Metric label="Refresh due" value={counts.refresh_required} />
        <Metric label="Expired" value={counts.expired} />
        <Metric label="Revoked" value={counts.revoked} />
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <h2 className="text-lg font-semibold">Emergency session control</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Revocation requires admin or owner permission plus MFA step-up. The database revokes
              the exact tenant scope and appends an immutable audit event in one transaction.
            </p>
          </div>
          <button
            type="button"
            disabled={pending || revocable === 0 || reason.trim().length < 3}
            onClick={() => revoke("organization")}
            className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Revoke all active sessions
          </button>
        </div>
        <label className="mt-4 block text-sm font-medium" htmlFor="cli-revocation-reason">
          Required audit reason
        </label>
        <textarea
          id="cli-revocation-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Example: managed laptop was replaced"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
        />
        <p className="mt-2 text-xs text-muted">
          The audit chain stores a digest of this reason, not the reason text. Provider credentials
          and Hermes workload identities are managed separately in {" "}
          <Link href="/settings/integrations" className="font-semibold underline">Provider integrations</Link>.
        </p>
        {message ? <p role="status" className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm">{message}</p> : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Human CLI inventory</h2>
            <p className="mt-1 text-xs text-muted">Showing {sessions.length} of {total} sessions. No token hashes or credential values are queried.</p>
          </div>
        </div>
        {sessions.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-semibold">No browser-authorized CLI sessions</p>
            <p className="mt-2 text-sm text-muted">Sessions appear after a user completes <code>loopgraph auth login</code>.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                pending={pending}
                reasonReady={reason.trim().length >= 3}
                onRevokeSession={() => revoke("session", { sessionId: session.id })}
                onRevokeUser={() => revoke("user", { targetUserId: session.userId })}
              />
            ))}
          </div>
        )}
        {nextOffset !== undefined ? (
          <div className="border-t border-line p-4 text-center">
            <button
              type="button"
              disabled={pending}
              onClick={loadMore}
              className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Load older sessions
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SessionRow({
  session,
  pending,
  reasonReady,
  onRevokeSession,
  onRevokeUser
}: {
  session: CliSessionAdminView;
  pending: boolean;
  reasonReady: boolean;
  onRevokeSession: () => void;
  onRevokeUser: () => void;
}) {
  const canRevoke = session.status === "active" || session.status === "refresh_required";
  return (
    <article className="grid gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] xl:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold">{session.userName ?? session.userEmail ?? session.userId}</p>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[session.status]}`}>
            {STATUS_LABEL[session.status]}
          </span>
        </div>
        {session.userName && session.userEmail ? <p className="mt-1 truncate text-sm text-muted">{session.userEmail}</p> : null}
        <p className="mt-2 font-mono text-xs text-muted" title={session.id}>Session {session.id.slice(0, 8)}…</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs">
        <div>
          <dt className="text-muted">Last used</dt>
          <dd className="mt-0.5 font-medium">{formatTime(session.lastUsedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">Refresh expires</dt>
          <dd className="mt-0.5 font-medium">{formatTime(session.refreshExpiresAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Capability</dt>
          <dd className="mt-0.5 font-mono font-medium">{session.capabilities.join(", ") || "none"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 xl:justify-end">
        <button
          type="button"
          disabled={!canRevoke || pending || !reasonReady}
          onClick={onRevokeSession}
          className="rounded-md border border-line px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          Revoke device
        </button>
        <button
          type="button"
          disabled={!canRevoke || pending || !reasonReady}
          onClick={onRevokeUser}
          className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Revoke user
        </button>
      </div>
    </article>
  );
}

function formatTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}
