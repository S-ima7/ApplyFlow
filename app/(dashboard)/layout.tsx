import { AppHeader } from "@/components/layout/app-header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader userName={user.name} userEmail={user.email} />
        <main className="app-main flex-1">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}
