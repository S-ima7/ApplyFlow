import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth-guard";

export default async function SettingsPage() {
  const user = await requireUser();

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
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>Google Calendar readonly連携はv0.2で追加します。</p>
          <p>Gmail取り込みとAI抽出はv1.0で追加します。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}
