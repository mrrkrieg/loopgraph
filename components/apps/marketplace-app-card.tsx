import React from "react";
import Link from "next/link";
import type { MarketplaceSearchEntry } from "@/lib/app-platform/read-model";
import { AppStatusPill } from "./app-status-pill";

export function MarketplaceAppCard({ entry }: { entry: MarketplaceSearchEntry }) {
  const latest = entry.app.versions.find((version) => version.version === entry.app.latestVersion)!;
  const installedHref = entry.installation
    ? `/apps/${encodeURIComponent(entry.installation.id)}`
    : `/marketplace/${encodeURIComponent(entry.app.id)}`;
  return (
    <article className="flex h-full flex-col rounded-xl border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">
            {entry.app.department.replace(/_/g, " ")}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{entry.app.name}</h2>
        </div>
        <AppStatusPill state={entry.installation?.state} readiness={entry.readiness?.state} />
      </div>
      <p className="mt-3 text-sm leading-6 text-ink/65">{entry.app.summary}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-line py-4 text-xs">
        <Fact label="Included loops" value={String(latest.includedLoopCount)} />
        <Fact label="Stacks" value={`${latest.presets.length} presets`} />
        <Fact label="Required" value={`${latest.requiredCapabilities.length} capabilities`} />
        <Fact label="Optional" value={`${latest.optionalCapabilities.length} capabilities`} />
        <Fact label="Maturity" value={maturityEvidenceLabel(latest)} />
        <Fact label="Version" value={`v${latest.version}`} />
        <Fact label="Publisher" value={entry.app.publisher.name} />
        <Fact label="Historical preview" value={historicalPreviewLabel(entry.previewStatus.historicalReplay)} />
      </div>
      <CapabilitySummary capabilities={latest.requiredCapabilities} label="Required capabilities" />
      {latest.optionalCapabilities.length > 0 ? <CapabilitySummary capabilities={latest.optionalCapabilities} label="Optional capabilities" /> : null}
      <div className="mt-4 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold uppercase tracking-[0.1em] text-ink/40">Artifact trust</span>
        <span className="capitalize text-ink/65">{latest.provenanceVerified ? "verified" : `${latest.source.sourceType.replace(/_/g, " ")} · local only`}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {latest.presets.map((preset) => (
          <span className="rounded-full bg-paper px-2.5 py-1 text-xs text-ink/65" key={preset.id}>
            {preset.name}
          </span>
        ))}
      </div>
      <div className="mt-auto pt-5">
        <Link
          className="inline-flex w-full items-center justify-center rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/85"
          href={installedHref}
        >
          {entry.installation ? "Open installed app" : "View app"}
        </Link>
      </div>
    </article>
  );
}

function CapabilitySummary({ capabilities, label }: { capabilities: string[]; label: string }) {
  const visible = capabilities.slice(0, 2);
  const remaining = capabilities.length - visible.length;
  return (
    <div className="mt-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {visible.map((capability) => <span className="rounded-full border border-line px-2.5 py-1 text-xs text-ink/65" key={capability}>{capabilityLabel(capability)}</span>)}
        {remaining > 0 ? <span className="rounded-full border border-line px-2.5 py-1 text-xs text-ink/50">+{remaining} more</span> : null}
      </div>
    </div>
  );
}

function capabilityLabel(value: string) {
  return value.replace(/[._]/g, " ");
}

export function historicalPreviewLabel(value: MarketplaceSearchEntry["previewStatus"]["historicalReplay"]) {
  if (value === "completed") return "completed";
  if (value === "available") return "available now";
  if (value === "requires_readiness") return "after setup + rehearsal";
  return "after install";
}

export function maturityEvidenceLabel(version: MarketplaceSearchEntry["app"]["versions"][number]): string {
  const evidence = version.maturityEvidence;
  if (!evidence) return `${version.maturity.replace(/_/g, " ")} · no recorded test`;
  return `${version.maturity.replace(/_/g, " ")} · ${evidence.passedScenarioCount}/${evidence.scenarioCount} synthetic`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold uppercase tracking-[0.12em] text-ink/40">{label}</div>
      <div className="mt-1 capitalize text-ink/75">{value}</div>
    </div>
  );
}
