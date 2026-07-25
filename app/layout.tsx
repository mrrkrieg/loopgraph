import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { WorkspaceBanner } from "@/components/workspace-banner";
import { isHostedPreview } from "@/lib/hosted-preview";

export const metadata: Metadata = {
  metadataBase: new URL("https://loopgraph.vercel.app"),
  title: "Loopgraph",
  description:
    "Map, run, review, and improve AI-human company loops."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const showPreviewFeatures = isHostedPreview();

  return (
    <html lang="en">
      <body>
        <AppShell
          showPreviewFeatures={showPreviewFeatures}
          workspaceBanner={<WorkspaceBanner previewMode={showPreviewFeatures} />}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
