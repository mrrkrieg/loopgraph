export function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-ink/10 bg-sage/20 px-2.5 py-1 text-xs font-medium text-ink">
      {children}
    </span>
  );
}
