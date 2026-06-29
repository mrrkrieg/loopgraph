import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { WorkspaceBanner } from "@/components/workspace-banner";

export const metadata: Metadata = {
  title: "Loopgraph",
  description:
    "Map, run, review, and improve AI-human company loops."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppShell>
          <WorkspaceBanner />
          {children}
        </AppShell>
      </body>
    </html>
  );
}
