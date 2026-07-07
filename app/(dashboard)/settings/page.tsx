import { signIn } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGoogleCalendarConnectionStatus } from "@/lib/google-calendar";
import { requireUser } from "@/lib/auth-guard";

export default async function SettingsPage() {
  const user = await requireUser();
  const googleCalendar = await getGoogleCalendarConnectionStatus(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">Settings</h2>
        <p className="text-sm text-slate-500">プロフィールと連携設定を確認します。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="ユーザー名" value={user.name ?? "-"} />
          <SettingRow label="メールアドレス" value={user.email ?? "-"} />
          <SettingRow label="タイムゾーン" value={user.timezone ?? "Asia/Tokyo"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>外部連携</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-900">Google Calendar</p>
                <Badge variant={googleCalendar.status === "connected" ? "success" : "warning"}>
                  {getGoogleCalendarStatusLabel(googleCalendar.status)}
                </Badge>
              </div>
              <p>
                Primary calendarの予定を読み取り、ApplyFlowのカレンダー表示と衝突検知に利用します。
              </p>
              {googleCalendar.message ? (
                <p className="text-amber-700">{googleCalendar.message}</p>
              ) : null}
            </div>
            {googleCalendar.status !== "connected" ? (
              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: "/settings" });
                }}
              >
                <Button type="submit" size="sm">
                  再ログイン
                </Button>
              </form>
            ) : null}
          </div>
          <p>Gmail取り込みとAI抽出はv1.0で追加します。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function getGoogleCalendarStatusLabel(status: string) {
  switch (status) {
    case "connected":
      return "連携済み";
    case "missing_scope":
      return "権限不足";
    case "missing_token":
      return "再認証が必要";
    case "not_connected":
      return "未連携";
    default:
      return "取得エラー";
  }
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}
