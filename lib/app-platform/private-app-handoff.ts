import type { WorkspaceAppInstallation } from "loopgraph/core";

type Derivation = NonNullable<WorkspaceAppInstallation["derivation"]>;

export type InstalledAppPresentation = {
  title: string;
  kind: "installed" | "private_derived";
  kindLabel: string;
  description: string;
  publisherPrompt?: string;
  derivation?: Derivation;
};

export function installedAppPresentation(input: {
  appName: string;
  installationId: string;
  derivation?: WorkspaceAppInstallation["derivation"];
}): InstalledAppPresentation {
  if (!input.derivation) {
    return {
      title: input.appName,
      kind: "installed",
      kindLabel: "Installed App",
      description: "Operate, measure, and improve this installed business capability."
    };
  }
  return {
    title: input.derivation.derivedAppId,
    kind: "private_derived",
    kindLabel: "Private derived App",
    description: `A workspace-private variant of ${input.appName}. Its namespaced loops and overlay can change independently without mutating the upstream App.`,
    publisherPrompt: privateAppPublisherPrompt(input.installationId, input.derivation.derivedAppId),
    derivation: input.derivation
  };
}

export function privateAppPublisherPrompt(installationId: string, derivedAppId: string): string {
  return [
    `Capture installed App ${installationId} as the reusable private App ${derivedAppId}.`,
    "Parameterize company-specific values without copying their values, credentials, provider payloads, tenant IDs, or private references.",
    "Run the write-blocked developer preview and full publisher validation, then show me the exact permissions, artifact digest, signing key, and private-catalog publish plan.",
    "Do not sign or publish until I approve that final plan."
  ].join(" ");
}
