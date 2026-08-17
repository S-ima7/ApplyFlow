"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  CalendarDays,
  LayoutDashboard,
  Mail,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "ホーム", icon: LayoutDashboard },
  { href: "/applications", label: "応募", icon: BriefcaseBusiness },
  { href: "/calendar", label: "予定", icon: CalendarDays },
  { href: "/email-import", label: "メール", icon: Mail },
  { href: "/settings", label: "設定", icon: Settings }
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="メインナビゲーション"
      className="mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:hidden"
    >
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-semibold",
              active ? "text-blue-700" : "text-slate-500"
            )}
          >
            <item.icon className="h-5 w-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
