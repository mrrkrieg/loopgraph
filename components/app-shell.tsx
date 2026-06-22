import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/loops", label: "Loops" },
  { href: "/loops/new", label: "New Loop" },
  { href: "/management", label: "Management" },
  { href: "/templates", label: "Templates" },
  { href: "/settings", label: "Settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white/75 px-4 py-5 backdrop-blur lg:block">
        <Link href="/dashboard" className="block rounded-lg border border-ink bg-ink px-4 py-3 text-white">
          <div className="text-sm font-semibold tracking-wide">Loop Engineering Builder</div>
          <div className="mt-1 text-xs text-white/70">Company loops, verified</div>
        </Link>
        <nav className="mt-6 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-ink/75 hover:bg-ink hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-line bg-paper/90 px-5 py-3 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="font-semibold">
            Loop Engineering Builder
          </Link>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
