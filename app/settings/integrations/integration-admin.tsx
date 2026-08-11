"use client";

import { useState, useTransition } from "react";
import type { ConnectorInstallationView, ProviderOnboardingProfile } from "loopgraph/core";
import type {
  ConnectorKillSwitchAdminView,
  WorkloadIdentityAdminView
} from "@/lib/connector-broker/admin";

const BROKER_CAPABILITIES = [
  "provider.oauth.authorize",
  "provider.oauth.exchange",
  "provider.oauth.refresh",
  "provider.oauth.revoke",
  "provider.webhooks.subscribe",
  "provider.webhooks.verify",
  "provider.health.read",
  "provider.data.read",
  "provider.draft.write",
  "provider.action.execute",
  "provider.disconnect"
] as const;

export function IntegrationAdmin({
  initialInstallations,
  initialWorkloadIdentities,
  initialKillSwitches,
  providers,
  initialProviderId,
  brokerConfigured
}: {
  initialInstallations: ConnectorInstallationView[];
  initialWorkloadIdentities: WorkloadIdentityAdminView[];
  initialKillSwitches: ConnectorKillSwitchAdminView[];
  providers: ProviderOnboardingProfile[];
  initialProviderId?: string;
  brokerConfigured: boolean;
}) {
  const [installations, setInstallations] = useState(initialInstallations);
  const [workloadIdentities, setWorkloadIdentities] = useState(initialWorkloadIdentities);
  const [killSwitches, setKillSwitches] = useState(initialKillSwitches);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function connect(formData: FormData) {
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: String(formData.get("provider_id") ?? ""),
          displayName: String(formData.get("display_name") ?? ""),
          environment: String(formData.get("environment") ?? "development"),
          customerManagedKeyRef: String(formData.get("customer_managed_key_ref") ?? "") || undefined
        })
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Provider onboarding failed.");
        return;
      }
      if (body.installation) {
        const installation = body.installation as ConnectorInstallationView;
        setInstallations((current) => [installation, ...current.filter((item) => item.id !== installation.id)]);
      }
      const nextUrl = typeof body.authorizationUrl === "string"
        ? body.authorizationUrl
        : typeof body.instructionsUrl === "string" ? body.instructionsUrl : undefined;
      if (nextUrl) window.location.assign(nextUrl);
      else setMessage("Connector was prepared. Follow the provider instructions shown by the broker.");
    });
  }

  function rotate(installationId: string) {
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch(`/api/integrations/${encodeURIComponent(installationId)}/rotate`, { method: "POST" });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Credential rotation failed.");
        return;
      }
      const installation = body.installation as ConnectorInstallationView;
      setInstallations((current) => current.map((item) => item.id === installationId ? installation : item));
      setMessage("Credential rotation completed through the connector broker.");
    });
  }

  function checkHealth(installationId: string) {
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch(`/api/integrations/${encodeURIComponent(installationId)}/health`, { method: "POST" });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Connector health check failed.");
        return;
      }
      const checkedAt = String(body.checkedAt);
      const status = body.status === "active" ? "active" : "degraded";
      setInstallations((current) => current.map((item) => item.id === installationId ? { ...item, status, lastHealthCheckAt: checkedAt } : item));
      setMessage(status === "active" ? "Provider credential and fixed health endpoint are reachable." : "Provider connection is degraded.");
    });
  }

  function activateWebhook(formData: FormData) {
    const installationId = String(formData.get("installation_id") ?? "");
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch(`/api/integrations/${encodeURIComponent(installationId)}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerSubscriptionId: String(formData.get("provider_subscription_id") ?? ""),
          providerConfigured: formData.get("provider_configured") === "on"
        })
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Webhook activation failed.");
        return;
      }
      const installation = body.installation as ConnectorInstallationView;
      setInstallations((current) => current.map((item) => item.id === installationId ? installation : item));
      setMessage(`${installation.providerId} webhook is ${installation.webhookStatus}. Endpoint: ${String(body.endpointUrl ?? "broker route")}`);
    });
  }

  function revoke(formData: FormData) {
    const installationId = String(formData.get("installation_id") ?? "");
    const emergency = formData.get("emergency") === "on";
    const reason = String(formData.get("reason") ?? "").trim();
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch(`/api/integrations/${encodeURIComponent(installationId)}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, emergency })
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Provider revocation failed.");
        return;
      }
      const status = body.status === "revoked" ? "revoked" : "revoking";
      setInstallations((current) => current.map((item) => item.id === installationId
        ? { ...item, status, allowedCapabilities: [], updatedAt: new Date().toISOString() }
        : item));
      setMessage(status === "revoked"
        ? "Provider access and vault material were revoked."
        : "New provider actions are blocked. Provider/vault revocation is queued.");
    });
  }

  function disableNow(formData: FormData) {
    const installationId = String(formData.get("installation_id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    startTransition(async () => {
      setMessage(undefined);
      const response = await fetch(`/api/integrations/${encodeURIComponent(installationId)}/disable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Connector disable failed.");
        return;
      }
      setInstallations((current) => current.map((item) => item.id === installationId
        ? { ...item, status: "locally_disabled", allowedCapabilities: [], updatedAt: new Date().toISOString() }
        : item));
      setMessage("Connector access is locally disabled. No credential can be resolved; provider cleanup has not been started.");
    });
  }

  function deleteMetadata(installationId: string) {
    if (!window.confirm("Delete this revoked connector's non-secret metadata and consent record? Audit events remain retained.")) return;
    startTransition(async () => {
      const response = await fetch(`/api/integrations/${encodeURIComponent(installationId)}`, { method: "DELETE" });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Connector metadata deletion failed.");
        return;
      }
      setInstallations((current) => current.filter((item) => item.id !== installationId));
      setMessage("Connector metadata was deleted. Immutable security audit records remain retained.");
    });
  }

  async function reloadSecurityControls() {
    const [identityResponse, killSwitchResponse] = await Promise.all([
      fetch("/api/integrations/workload-identities", { cache: "no-store" }),
      fetch("/api/integrations/kill-switches", { cache: "no-store" })
    ]);
    const identityBody = await identityResponse.json() as { identities?: WorkloadIdentityAdminView[]; error?: string };
    const killSwitchBody = await killSwitchResponse.json() as { killSwitches?: ConnectorKillSwitchAdminView[]; error?: string };
    if (!identityResponse.ok) throw new Error(identityBody.error ?? "Could not refresh workload identities");
    if (!killSwitchResponse.ok) throw new Error(killSwitchBody.error ?? "Could not refresh kill switches");
    setWorkloadIdentities(identityBody.identities ?? []);
    setKillSwitches(killSwitchBody.killSwitches ?? []);
  }

  function saveWorkloadIdentity(formData: FormData) {
    startTransition(async () => {
      setMessage(undefined);
      const expiresAt = String(formData.get("expires_at") ?? "");
      const response = await fetch("/api/integrations/workload-identities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issuer: String(formData.get("issuer") ?? ""),
          subject: String(formData.get("subject") ?? ""),
          audience: String(formData.get("audience") ?? ""),
          environment: String(formData.get("workload_environment") ?? "production"),
          workloadType: String(formData.get("workload_type") ?? "hermes"),
          capability: String(formData.get("capability") ?? ""),
          connectionId: String(formData.get("connection_id") ?? "") || undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          confirmationKeyThumbprint: String(formData.get("confirmation_key_thumbprint") ?? "") || undefined,
          reason: String(formData.get("grant_reason") ?? "")
        })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Workload grant failed.");
        return;
      }
      try {
        await reloadSecurityControls();
        setMessage("Workload identity and exact capability grant were saved and audited.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Grant saved; refresh to see it.");
      }
    });
  }

  function revokeWorkload(credentialId: string) {
    const reason = window.prompt("Why is this workload identity being revoked?")?.trim();
    if (!reason) return;
    startTransition(async () => {
      const response = await fetch("/api/integrations/workload-identities", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId, reason })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Workload revocation failed.");
        return;
      }
      await reloadSecurityControls();
      setMessage("Workload principal and all of its grants were revoked.");
    });
  }

  function activateKillSwitch(formData: FormData) {
    startTransition(async () => {
      setMessage(undefined);
      const scopeType = String(formData.get("scope_type") ?? "connection");
      const scopeValue = String(formData.get("scope_value") ?? "");
      const environment = String(formData.get("kill_environment") ?? "");
      const expiresAt = String(formData.get("kill_expires_at") ?? "");
      const response = await fetch("/api/integrations/kill-switches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeValue: scopeType === "environment" ? environment : scopeValue,
          environment: environment || undefined,
          reason: String(formData.get("kill_reason") ?? ""),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined
        })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Kill switch activation failed.");
        return;
      }
      await reloadSecurityControls();
      setMessage("The kill switch is active and will be evaluated before credential resolution.");
    });
  }

  function clearKillSwitch(id: string) {
    const reason = window.prompt("Why is this kill switch safe to clear?")?.trim();
    if (!reason) return;
    startTransition(async () => {
      const response = await fetch("/api/integrations/kill-switches", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, reason })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Kill switch could not be cleared.");
        return;
      }
      await reloadSecurityControls();
      setMessage("The kill switch was cleared and the change was audited.");
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold">Connect a provider</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/60">
              Consent happens at the provider. Tokens go directly to your configured vault; Loopgraph stores only the provider, scopes, health, and an opaque credential reference.
            </p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${brokerConfigured ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {brokerConfigured ? "Broker ready" : "Broker not configured"}
          </span>
        </div>
        <form action={connect} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            Provider
            <select name="provider_id" defaultValue={initialProviderId ?? providers[0]?.providerId} className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" disabled={pending || !brokerConfigured}>
              {providers.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">
            Environment
            <select name="environment" defaultValue="production" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" disabled={pending || !brokerConfigured}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Connection name
            <input name="display_name" required maxLength={120} placeholder="Production CRM" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2" disabled={pending || !brokerConfigured} />
          </label>
          <label className="text-sm font-medium md:col-span-2">
            Customer-managed key reference <span className="font-normal text-ink/45">(optional, never the key value)</span>
            <input name="customer_managed_key_ref" placeholder="aws-kms://arn:aws:kms:region:account:key/key-id" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-xs" disabled={pending || !brokerConfigured} />
          </label>
          <button type="submit" disabled={pending || !brokerConfigured} className="w-fit rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
            {pending ? "Working…" : "Continue to provider consent"}
          </button>
        </form>
        {message ? <p role="status" className="mt-4 rounded-md border border-line bg-paper px-3 py-2 text-sm">{message}</p> : null}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold">Provider access</h2>
        <p className="mt-1 text-sm leading-6 text-ink/60">Review consent, granted scopes, health, rotation, and deletion. Every change is written to the tenant audit chain.</p>
        {installations.length === 0 ? (
          <div className="mt-5 rounded-md border border-dashed border-line p-8 text-center text-sm text-ink/55">No provider credentials are connected to this organization.</div>
        ) : (
          <div className="mt-5 space-y-4">
            {installations.map((installation) => {
              const revoked = ["revoked", "deleted", "disconnected", "failed"].includes(installation.status);
              const locallyDisabled = ["disabling", "locally_disabled", "provider_revocation_pending", "subscriptions_removing", "revoking", "deletion_pending"].includes(installation.status);
              const blocked = revoked || locallyDisabled;
              return (
                <article key={installation.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{installation.displayName}</h3>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs">{installation.providerId}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${revoked ? "bg-slate-100 text-slate-600" : installation.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{installation.status}</span>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs">{installation.environment}</span>
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs text-ink/60 sm:grid-cols-2">
                        <div><dt className="font-semibold text-ink/75">Granted scopes</dt><dd className="mt-1 break-words">{installation.grantedScopes.join(", ") || "None recorded"}</dd></div>
                        <div><dt className="font-semibold text-ink/75">Capabilities</dt><dd className="mt-1 break-words">{installation.allowedCapabilities.join(", ") || "Blocked"}</dd></div>
                        <div><dt className="font-semibold text-ink/75">Last health check</dt><dd className="mt-1">{formatDate(installation.lastHealthCheckAt)}</dd></div>
                        <div><dt className="font-semibold text-ink/75">Last rotation</dt><dd className="mt-1">{formatDate(installation.lastRotatedAt)}</dd></div>
                        <div><dt className="font-semibold text-ink/75">Webhook</dt><dd className="mt-1">{installation.webhookStatus}</dd></div>
                      </dl>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!blocked ? <button disabled={pending} onClick={() => checkHealth(installation.id)} className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink">Check health</button> : null}
                      {!blocked ? <button disabled={pending} onClick={() => rotate(installation.id)} className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink">Rotate now</button> : null}
                      {revoked ? <button disabled={pending} onClick={() => deleteMetadata(installation.id)} className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:border-red-500">Delete metadata</button> : null}
                    </div>
                  </div>
                  {!blocked ? (
                    <form action={activateWebhook} className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
                      <input type="hidden" name="installation_id" value={installation.id} />
                      <label className="text-xs font-semibold">Provider subscription ID <span className="font-normal text-ink/45">(for console-managed providers)</span><input name="provider_subscription_id" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
                      <p className="self-end rounded-md bg-paper px-3 py-2 text-xs leading-5 text-ink/60">Webhook signing material must already exist in this connector&apos;s broker-derived vault object. Stripe provisions it automatically.</p>
                      <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" name="provider_configured" /> Provider-side setup is complete</label>
                      <button disabled={pending} className="w-fit rounded-md border border-line px-3 py-2 text-xs font-semibold hover:border-ink">Activate verified webhook</button>
                    </form>
                  ) : null}
                  {!blocked ? (
                    <form action={disableNow} className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[1fr_auto] md:items-end">
                      <input type="hidden" name="installation_id" value={installation.id} />
                      <label className="text-xs font-semibold">Immediate disable reason<input name="reason" minLength={3} maxLength={1000} required placeholder="Pause access while the incident is reviewed" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
                      <button disabled={pending} className="rounded-md border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 hover:border-amber-600">Disable now</button>
                    </form>
                  ) : null}
                  {!revoked ? (
                    <form action={revoke} className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[1fr_auto_auto] md:items-end">
                      <input type="hidden" name="installation_id" value={installation.id} />
                      <label className="text-xs font-semibold">Disconnect reason<input name="reason" minLength={3} maxLength={500} required placeholder="Access no longer required" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
                      <label className="flex items-center gap-2 pb-2 text-xs font-semibold"><input type="checkbox" name="emergency" /> Emergency</label>
                      <button disabled={pending} className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:border-red-500">Disconnect</button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold">Workload identities</h2>
        <p className="mt-1 text-sm leading-6 text-ink/60">Authorize a short-lived Hermes runtime identity separately from provider consent. Each grant is bound to one tenant, environment, capability, and optional connection.</p>
        <form action={saveWorkloadIdentity} className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold">Issuer<input required type="url" name="issuer" placeholder="https://issuer.example.com" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Subject<input required name="subject" placeholder="spiffe://example.com/hermes/production" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Broker audience<input required name="audience" placeholder="https://broker.example.com" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Environment<select name="workload_environment" defaultValue="production" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option></select></label>
          <label className="text-xs font-semibold">Workload type<input required name="workload_type" defaultValue="hermes" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Capability<select name="capability" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal">{BROKER_CAPABILITIES.map((capability) => <option key={capability}>{capability}</option>)}</select></label>
          <label className="text-xs font-semibold">Connection ID <span className="font-normal text-ink/45">(optional)</span><input name="connection_id" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Expires at <span className="font-normal text-ink/45">(optional)</span><input type="datetime-local" name="expires_at" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Confirmation-key SHA-256 <span className="font-normal text-ink/45">(optional)</span><input name="confirmation_key_thumbprint" pattern="[a-f0-9]{64}" className="mt-1 w-full rounded-md border border-line px-3 py-2 font-mono text-xs font-normal" /></label>
          <label className="text-xs font-semibold md:col-span-2">Grant reason<input required minLength={3} maxLength={1000} name="grant_reason" placeholder="Hermes production router needs health reads for this connection" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <button disabled={pending} className="w-fit rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-45">Save exact grant</button>
        </form>
        <div className="mt-5 space-y-3">
          {workloadIdentities.length === 0 ? <p className="rounded-md border border-dashed border-line p-5 text-sm text-ink/55">No workload identities are registered.</p> : workloadIdentities.map((identity) => (
            <article key={identity.credentialId} className="rounded-md border border-line p-4 text-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div><p className="font-semibold">{identity.credentialId} <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs">{identity.status}</span></p><p className="mt-1 break-all text-xs text-ink/55">{identity.subject}</p><p className="mt-1 text-xs text-ink/55">{identity.environment} · {identity.workloadType} · {identity.confirmationKeyBound ? "sender-bound" : "bearer JWT"}</p></div>
                {identity.status === "active" ? <button disabled={pending} onClick={() => revokeWorkload(identity.credentialId)} className="w-fit rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Revoke identity</button> : null}
              </div>
              <ul className="mt-3 space-y-1 text-xs text-ink/65">{identity.grants.map((grant) => <li key={grant.id}><span className="font-semibold">{grant.capability}</span> · {grant.connectionId ?? "all connections"} · {grant.status}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold">Emergency policy controls</h2>
        <p className="mt-1 text-sm leading-6 text-ink/60">Stop organization, environment, provider, connection, capability, loop, or agent access locally. Active switches are checked before any vault lookup.</p>
        <form action={activateKillSwitch} className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold">Scope<select name="scope_type" defaultValue="connection" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal"><option value="connection">Connection</option><option value="provider">Provider</option><option value="capability">Capability</option><option value="loop">Loop</option><option value="agent">Agent</option><option value="environment">Environment</option><option value="organization">Organization</option></select></label>
          <label className="text-xs font-semibold">Scope value<input required name="scope_value" placeholder="Connection, provider, capability, loop, or agent ID" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold">Environment <span className="font-normal text-ink/45">(optional except environment scope)</span><select name="kill_environment" defaultValue="" className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal"><option value="">All environments</option><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option></select></label>
          <label className="text-xs font-semibold">Expires at <span className="font-normal text-ink/45">(optional)</span><input type="datetime-local" name="kill_expires_at" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold md:col-span-2">Reason<input required minLength={3} maxLength={1000} name="kill_reason" placeholder="Contain suspected provider compromise" className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm font-normal" /></label>
          <button disabled={pending} className="w-fit rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-45">Activate kill switch</button>
        </form>
        <div className="mt-5 space-y-2">
          {killSwitches.filter((item) => item.status === "active").length === 0 ? <p className="rounded-md border border-dashed border-line p-5 text-sm text-ink/55">No active kill switches.</p> : killSwitches.filter((item) => item.status === "active").map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-md border border-red-100 bg-red-50/40 p-3 text-sm md:flex-row md:items-center md:justify-between"><div><p className="font-semibold">{item.scopeType}: {item.scopeValue}</p><p className="text-xs text-ink/55">{item.environment ?? "all environments"} · {item.reason}</p></div><button disabled={pending} onClick={() => clearKillSwitch(item.id)} className="w-fit rounded-md border border-line bg-white px-3 py-2 text-xs font-semibold">Clear after review</button></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
}
