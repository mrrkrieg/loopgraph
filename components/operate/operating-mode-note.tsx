import Link from "next/link";

export function OperatingModeNote({ mode }: { mode: "preview" | "local" }) {
  if (mode === "preview") {
    return (
      <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-950">
        <strong>Illustrative hosted preview.</strong> These records demonstrate the complete operating cycle and are never written into an installed workspace. Local Loopgraph shows only the opportunities, decisions, measurements, and value created from your own Hermes events.
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
      <strong>Project-local evidence.</strong> This view reads only your current project&apos;s <code className="rounded bg-white px-1.5 py-0.5">.loopgraph</code> records. Ask Hermes to <code className="rounded bg-white px-1.5 py-0.5">start Loopgraph</code> or begin in{" "}
      <Link className="font-semibold underline" href="/discovery">
        Discovery
      </Link>.
    </div>
  );
}
