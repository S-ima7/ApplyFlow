import Link from "next/link";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  Settings
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: BriefcaseBusiness },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/waiting", label: "Waiting Reply", icon: Clock3 },
  { href: "/deadlines", label: "Deadlines", icon: AlertTriangle },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block">
      <div className="flex h-16 items-center border-b border-slate-200 px-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold">
          <ClipboardList className="h-5 w-5 text-blue-600" />
          ApplyFlow
        </Link>
      </div>
      <nav className="space-y-1 p-3">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
