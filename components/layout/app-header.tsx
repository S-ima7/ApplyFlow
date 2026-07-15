import Link from "next/link";
import { Plus } from "lucide-react";
import { signOut } from "@/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AppHeaderProps = {
  userName?: string | null;
  userEmail?: string | null;
};

export function AppHeader({ userName, userEmail }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          選考管理CRM
        </p>
        <h1 className="text-lg font-semibold text-slate-950">ApplyFlow</h1>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/applications/new"
          className={cn(buttonVariants(), "hidden md:inline-flex")}
        >
          <Plus className="h-4 w-4" />
          新規応募
        </Link>
        <div className="hidden text-right text-xs text-slate-500 sm:block">
          <p className="font-medium text-slate-700">{userName ?? "User"}</p>
          <p>{userEmail}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="secondary" size="sm">
            ログアウト
          </Button>
        </form>
      </div>
    </header>
  );
}
