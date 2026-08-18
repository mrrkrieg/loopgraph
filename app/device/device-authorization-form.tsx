"use client";

import { useState } from "react";

export function DeviceAuthorizationForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<"idle" | "submitting" | "approved" | "denied" | "error">("idle");
  const [message, setMessage] = useState("");

  async function decide(decision: "approve" | "deny") {
    setState("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: code, decision })
      });
      const payload = await response.json() as { decision?: string; error_description?: string };
      if (!response.ok) throw new Error(payload.error_description ?? "Authorization failed");
      setState(decision === "approve" ? "approved" : "denied");
      setMessage(decision === "approve"
        ? "This CLI can now read the marketplace for your organization. Return to the terminal."
        : "The CLI request was denied. You can close this page.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Authorization failed");
    }
  }

  const finished = state === "approved" || state === "denied";
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm">
      <label className="block text-sm font-semibold text-[var(--muted-foreground)]" htmlFor="device-code">
        Device code
      </label>
      <input
        id="device-code"
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        disabled={finished || state === "submitting"}
        autoComplete="one-time-code"
        className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-mono text-2xl tracking-[0.2em] outline-none focus:border-black"
        maxLength={16}
        placeholder="ABCD-EFGH"
      />
      <p className="mt-4 text-sm leading-6 text-[var(--muted-foreground)]">
        Approving grants only <code>marketplace.consume</code>. It does not grant provider access,
        graph mutation, publishing, or live execution. The session expires unless the CLI rotates
        its single-use refresh token, and organization membership is checked on every request.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={finished || state === "submitting" || code.trim().length < 8}
          onClick={() => void decide("approve")}
          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === "submitting" ? "Checking…" : "Authorize CLI"}
        </button>
        <button
          type="button"
          disabled={finished || state === "submitting" || code.trim().length < 8}
          onClick={() => void decide("deny")}
          className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          Deny
        </button>
      </div>
      {message ? (
        <p role="status" className={`mt-5 rounded-xl p-4 text-sm ${state === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
