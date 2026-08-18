import { signIn } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGoogleCalendarConnectionStatus } from "@/lib/google-calendar";
import { getGmailConnectionStatus } from "@/lib/gmail";
import { requireUser } from "@/lib/auth-guard";
import { BrowserExtensionSettings } from "@/features/browser-extension/components/browser-extension-settings";
import { getBrowserExtensionTokens } from "@/features/browser-extension/queries";
import { EmailMonitorSettings } from "@/features/email-monitor/components/email-monitor-settings";
import {
  DEFAULT_EMAIL_MONITOR_QUERY,
  getEmailMonitorOverview
} from "@/features/email-monitor/config";

export default async function SettingsPage() {
  const user = await requireUser();
  const [googleCalendar, gmail, browserExtensionTokens, emailMonitor] = await Promise.all([
    getGoogleCalendarConnectionStatus(user.id),
    getGmailConnectionStatus(user.id),
    getBrowserExtensionTokens(user.id),
    getEmailMonitorOverview(user.id)
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">設定</h2>
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
          <CardTitle>Gmail定期監視</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailMonitorSettings
            connected={gmail.status === "connected"}
            initial={{
              enabled: emailMonitor.config?.enabled ?? false,
              gmailQuery:
                emailMonitor.config?.gmailQuery ?? DEFAULT_EMAIL_MONITOR_QUERY,
              consentedAt: emailMonitor.config?.consentedAt?.toISOString() ?? null,
              lastRunAt: emailMonitor.config?.lastRunAt?.toISOString() ?? null,
              lastSuccessAt:
                emailMonitor.config?.lastSuccessAt?.toISOString() ?? null,
              lastErrorMessage: emailMonitor.config?.lastErrorMessage ?? null,
              counts: {
                pending: emailMonitor.statusCounts.PENDING,
                processing: emailMonitor.statusCounts.PROCESSING,
                autoApplied: emailMonitor.statusCounts.AUTO_APPLIED,
                reviewRequired: emailMonitor.statusCounts.REVIEW_REQUIRED,
                ignored: emailMonitor.statusCounts.IGNORED,
                retryWait: emailMonitor.statusCounts.RETRY_WAIT,
                failed: emailMonitor.statusCounts.FAILED
              }
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>外部連携</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600">
          <div className="flex flex-col items-stretch gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-900">Google Calendar</p>
                <Badge variant={googleCalendar.status === "connected" ? "success" : "warning"}>
                  {getGoogleCalendarStatusLabel(googleCalendar.status)}
                </Badge>
              </div>
              <p>
                Primary calendarの予定を読み取り、確定面談は利用者の操作時だけ登録します。
              </p>
              {googleCalendar.message ? (
                <p className="text-amber-700">{googleCalendar.message}</p>
              ) : null}
            </div>
            {googleCalendar.status !== "connected" ? (
              <form
                className="sm:shrink-0"
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: "/settings" });
                }}
              >
                <Button type="submit" size="sm" className="w-full sm:w-auto">
                  再ログイン
                </Button>
              </form>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-900">Gmail</p>
                <Badge variant={gmail.status === "connected" ? "success" : "warning"}>
                  {getGoogleCalendarStatusLabel(gmail.status)}
                </Badge>
              </div>
              <p>選考メールの検索とAI抽出に利用します。メール本文はDBに保存しません。</p>
              {gmail.message ? <p className="text-amber-700">{gmail.message}</p> : null}
            </div>
            {gmail.status !== "connected" ? (
              <form
                className="sm:shrink-0"
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo: "/settings" });
                }}
              >
                <Button type="submit" size="sm" className="w-full sm:w-auto">
                  再ログイン
                </Button>
              </form>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>ブラウザ拡張機能</CardTitle>
        </CardHeader>
        <CardContent>
          <BrowserExtensionSettings
            tokens={browserExtensionTokens.map((token) => ({
              id: token.id,
              tokenPrefix: token.tokenPrefix,
              createdAt: token.createdAt.toISOString(),
              lastUsedAt: token.lastUsedAt?.toISOString() ?? null
            }))}
          />
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
    <div className="flex flex-col items-start gap-1 border-b border-slate-100 pb-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="break-all text-sm font-semibold text-slate-900 sm:text-right">{value}</span>
    </div>
  );
}
