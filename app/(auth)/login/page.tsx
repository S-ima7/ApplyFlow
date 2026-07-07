import { redirect } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-blue-600 text-white">
            <BriefcaseBusiness className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">ApplyFlow</CardTitle>
          <CardDescription>
            応募、面談候補、返信待ち、期限を一元管理します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <Button type="submit" className="w-full">
              Googleでログイン
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
