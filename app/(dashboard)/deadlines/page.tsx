import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompleteDeadlineButton } from "@/features/deadlines/components/complete-deadline-button";
import { getDeadlines } from "@/features/deadlines/queries";
import { requireUser } from "@/lib/auth-guard";
import { deadlineStatusLabels, deadlineTypeLabels } from "@/lib/labels";
import { daysUntil, formatDateTime } from "@/lib/date";

export default async function DeadlinesPage() {
  const user = await requireUser();
  const deadlines = await getDeadlines(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">期限管理</h2>
        <p className="text-sm text-slate-500">返信期限、承諾期限、提出期限を一元管理します。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>期限一覧</CardTitle>
        </CardHeader>
        <CardContent>
          {deadlines.length === 0 ? (
            <p className="text-sm text-slate-500">期限はまだありません。</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {deadlines.map((deadline) => (
                  <div key={deadline.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-950">{deadline.title}</p>
                        <Link
                          href={`/applications/${deadline.applicationId}`}
                          className="mt-1 block text-sm text-blue-700"
                        >
                          {deadline.application.company.name} / {deadline.application.position}
                        </Link>
                      </div>
                      <Badge variant={deadline.status === "DONE" ? "success" : "warning"}>
                        {deadlineStatusLabels[deadline.status]}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                      <div className="text-sm">
                        <p className="font-medium">{formatDateTime(deadline.dueAt)}</p>
                        <p className="text-xs text-slate-500">
                          {deadlineTypeLabels[deadline.type]}・{daysUntil(deadline.dueAt)}
                        </p>
                      </div>
                      {deadline.status === "OPEN" ? (
                        <CompleteDeadlineButton deadlineId={deadline.id} />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4">期限</th>
                    <th className="py-3 pr-4">応募先</th>
                    <th className="py-3 pr-4">種別</th>
                    <th className="py-3 pr-4">日時</th>
                    <th className="py-3 pr-4">状態</th>
                    <th className="py-3 pr-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {deadlines.map((deadline) => (
                    <tr key={deadline.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-semibold">{deadline.title}</td>
                      <td className="py-3 pr-4">
                        <Link href={`/applications/${deadline.applicationId}`} className="hover:underline">
                          {deadline.application.company.name}
                        </Link>
                        <p className="text-xs text-slate-500">{deadline.application.position}</p>
                      </td>
                      <td className="py-3 pr-4">{deadlineTypeLabels[deadline.type]}</td>
                      <td className="py-3 pr-4">
                        <p>{formatDateTime(deadline.dueAt)}</p>
                        <p className="text-xs text-slate-500">{daysUntil(deadline.dueAt)}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={deadline.status === "DONE" ? "success" : "warning"}>
                          {deadlineStatusLabels[deadline.status]}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4">
                        {deadline.status === "OPEN" ? (
                          <CompleteDeadlineButton deadlineId={deadline.id} />
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
