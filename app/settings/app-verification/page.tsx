import { createHash } from "node:crypto";
import type { AppVerificationRegistry } from "loopgraph/runtime";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { callLoopgraphAppTool } from "@/lib/app-platform/tool-bridge";
import { getWorkspaceDatabase } from "@/lib/db/workspace-database";
import { getActiveLoopgraphProjectRoot } from "@/lib/loopgraph-runtime/storage-resolver";
import {
  importAppVerificationReceiptAction,
  revokeAppVerifierAction,
  trustAppVerifierAction
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AppVerificationSettingsPage() {
  const database = await getWorkspaceDatabase("integrations.read");
  const registry = await callLoopgraphAppTool("loopgraph_app_verification_registry_get", {
    projectRoot: getActiveLoopgraphProjectRoot()
  }) as AppVerificationRegistry & { privateKeyMaterialAccepted: false };
  const canManage = !database.hosted || database.role === "admin" || database.role === "owner";

  return (
    <>
      <PageHeader
        eyebrow="Enterprise assurance"
        title="App verification trust"
        description="Control which independent Ed25519 verifier public keys may attest that a production-proven App is Loopgraph verified. Private verifier keys remain outside Loopgraph."
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard
          title="Trusted verifier keys"
          description={`${registry.trustedVerifierKeys.length} key${registry.trustedVerifierKeys.length === 1 ? "" : "s"} in workspace ${registry.workspaceId}. Registry revision ${registry.revision}.`}
        >
          {registry.trustedVerifierKeys.length === 0 ? (
            <EmptyState text="No independent verifier is trusted. Apps cannot reach Loopgraph verified." />
          ) : (
            <div className="grid gap-3">
              {registry.trustedVerifierKeys.map((key) => (
                <div className="rounded-lg border border-line p-4" key={`${key.verifierId}/${key.keyId}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink">{key.verifierId}</div>
                      <div className="mt-1 font-mono text-xs text-ink/55">{key.keyId} · SHA256:{publicKeyFingerprint(key.publicKey)}</div>
                    </div>
                    <StatusPill active={!key.revokedAt} />
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-ink/65 sm:grid-cols-2">
                    <Metadata label="Approved by" value={key.approvedBy} />
                    <Metadata label="Approval reference" value={key.approvalRef} />
                    <Metadata label="Approved" value={formatDate(key.approvedAt)} />
                    {key.revokedAt ? <Metadata label="Revoked" value={`${formatDate(key.revokedAt)} by ${key.revokedBy}`} /> : null}
                  </dl>
                  {canManage && !key.revokedAt ? (
                    <form action={revokeAppVerifierAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <input type="hidden" name="verifier_id" value={key.verifierId} />
                      <input type="hidden" name="key_id" value={key.keyId} />
                      {!database.hosted ? <input required name="local_actor" placeholder="Local administrator" className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm" /> : null}
                      <input required name="revocation_ref" placeholder="Incident or change reference" className="min-w-0 flex-[2] rounded-md border border-line px-3 py-2 text-sm" />
                      <button type="submit" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Revoke key</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Trust a public key" description="Requires admin access and recent hosted step-up authentication. Private-key PEM blocks are rejected.">
          {canManage ? (
            <form action={trustAppVerifierAction} className="grid gap-3">
              <Field name="verifier_id" label="Verifier identity" placeholder="independent-auditor" />
              <Field name="key_id" label="Public key ID" placeholder="independent-auditor.primary" />
              <Field name="approval_ref" label="Approval reference" placeholder="change:SEC-42" />
              {!database.hosted ? <Field name="local_actor" label="Local approving administrator" placeholder="security-admin" /> : null}
              <label className="text-sm font-medium text-ink">Ed25519 public key
                <textarea required name="public_key" rows={7} spellCheck={false} placeholder="-----BEGIN PUBLIC KEY-----" className="mt-1 w-full rounded-md border border-line px-3 py-2 font-mono text-xs" />
              </label>
              <button type="submit" className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Trust public key</button>
            </form>
          ) : <EmptyState text="Your role can inspect verifier trust but cannot change it." />}
        </SectionCard>
      </div>

      <SectionCard className="mt-5" title="Independent verification receipts" description="Receipts are accepted only after signature validation and exact installation, App, and artifact-digest matching.">
        {registry.receipts.length === 0 ? (
          <EmptyState text="No independent verification receipts have been imported." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink/45"><tr><th className="p-3">App / installation</th><th className="p-3">Verifier</th><th className="p-3">Artifact</th><th className="p-3">Result</th><th className="p-3">Verified</th></tr></thead>
              <tbody>{registry.receipts.map((receipt) => <tr className="border-b border-line/70" key={receipt.id}><td className="p-3"><div className="font-medium">{receipt.appId}</div><div className="font-mono text-xs text-ink/50">{receipt.installationId}</div></td><td className="p-3">{receipt.verifierId}</td><td className="p-3 font-mono text-xs">{shortDigest(receipt.artifactDigest)}</td><td className="p-3">{receipt.status}</td><td className="p-3">{formatDate(receipt.verifiedAt)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {canManage ? (
          <form action={importAppVerificationReceiptAction} className="mt-5 grid gap-3 rounded-lg border border-line bg-slate-50 p-4">
            <div className="font-semibold">Import a signed receipt</div>
            <Field name="import_ref" label="Approval or audit reference" placeholder="audit:APP-2026-08" />
            {!database.hosted ? <Field name="local_actor" label="Local importing administrator" placeholder="security-admin" /> : null}
            <label className="text-sm font-medium text-ink">Receipt JSON
              <textarea required name="receipt" rows={9} spellCheck={false} placeholder="{ &quot;schemaVersion&quot;: &quot;loopgraph-app-independent-verification/v1alpha1&quot;, ... }" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-xs" />
            </label>
            <button type="submit" className="justify-self-start rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Verify and import</button>
          </form>
        ) : null}
      </SectionCard>
    </>
  );
}

function Field({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return <label className="text-sm font-medium text-ink">{label}<input required name={name} placeholder={placeholder} className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm" /></label>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-line bg-slate-50 p-4 text-sm text-ink/60">{text}</div>;
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{active ? "Active" : "Revoked"}</span>;
}

function Metadata({ label, value }: { label: string; value?: string }) {
  return <div><dt className="font-semibold text-ink/45">{label}</dt><dd className="mt-0.5 break-all">{value ?? "—"}</dd></div>;
}

function publicKeyFingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 18)}…${digest.slice(-8)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}
