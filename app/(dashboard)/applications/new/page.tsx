import { ApplicationForm } from "@/features/applications/components/application-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewApplicationPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">応募先作成</h2>
        <p className="text-sm text-slate-500">最小情報を登録し、詳細画面で選考を追加します。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplicationForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
