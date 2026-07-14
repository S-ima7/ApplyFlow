import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/applications", label: "Applications" },
  { href: "/calendar", label: "Calendar" },
  { href: "/waiting", label: "Waiting" },
  { href: "/deadlines", label: "Deadlines" },
  { href: "/email-import", label: "Gmail" },
  { href: "/settings", label: "Settings" }
];

export function MobileNav() {
  return (
    <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
