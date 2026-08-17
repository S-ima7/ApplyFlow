"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  Mail,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/applications", label: "応募先", icon: BriefcaseBusiness },
  { href: "/calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/waiting", label: "返信待ち", icon: Clock3 },
  { href: "/deadlines", label: "期限管理", icon: AlertTriangle },
  { href: "/email-import", label: "メール取込", icon: Mail },
  { href: "/settings", label: "設定", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar-shell hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block">
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
            aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              isActivePath(pathname, item.href)
                ? "bg-blue-50 text-blue-700"
                : "text-slate-700 hover:bg-slate-100"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
