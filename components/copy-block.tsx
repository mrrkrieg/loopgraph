"use client";

import { useState } from "react";

export function CopyBlock({
  title,
  content
}: {
  title: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-ink">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button
          type="button"
          className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white hover:text-ink"
          onClick={async () => {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[30rem] overflow-auto p-4 text-xs leading-5 text-white/85">
        <code>{content}</code>
      </pre>
    </div>
  );
}
