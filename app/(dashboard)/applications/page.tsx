import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApplications } from "@/features/applications/queries";
import { requireUser } from "@/lib/auth-guard";
import {
  applicationStatusLabels,
  priorityLabels,
  applicationTypeLabels
} from "@/lib/labels";
import { formatDate, formatTimeRange } from "@/lib/date";

export default async function ApplicationsPage() {
  const user = await requireUser();
  const applications = await getApplications(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">応募先</h2>
          <p className="text-sm text-slate-500">応募先と選考状況を一覧します。</p>
        </div>
        <Link
          href="/applications/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          応募先を追加
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>応募先一覧</CardTitle>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-8 text-center">
              <p className="font-semibold">まだ応募先が登録されていません。</p>
              <p className="mt-1 text-sm text-slate-500">最初の応募先を追加しましょう。</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {applications.map((application) => {
                  const nextInterview = application.stages
                    .flatMap((stage) => stage.interviews)
                    .find((interview) => interview.confirmedStartAt);
                  const nextSlot = application.stages
                    .flatMap((stage) => stage.interviews)
                    .flatMap((interview) => interview.proposedSlots)
                    .find((slot) => slot.status === "PENDING");

                  return (
                    <Link
                      key={application.id}
                      href={`/applications/${application.id}`}
                      className="block rounded-lg border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-slate-950">
                            {application.company.name}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-600">
                            {application.position}
                          </p>
                        </div>
                        <Badge>{applicationStatusLabels[application.status]}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="muted">
                          {applicationTypeLabels[application.applicationType]}
                        </Badge>
                        <Badge variant="muted">
                          優先度 {priorityLabels[application.priority]}
                        </Badge>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <dt className="text-slate-500">次の予定</dt>
                          <dd className="mt-1 font-medium text-slate-800">
                            {nextInterview
                              ? formatTimeRange(
                                  nextInterview.confirmedStartAt,
                                  nextInterview.confirmedEndAt
                                )
                              : nextSlot
                                ? formatTimeRange(nextSlot.startAt, nextSlot.endAt)
                                : "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">期限</dt>
                          <dd className="mt-1 font-medium text-slate-800">
                            {application.deadlines[0]
                              ? formatDate(application.deadlines[0].dueAt)
                              : "-"}
                          </dd>
                        </div>
                      </dl>
                    </Link>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-3 pr-4">会社名</th>
                    <th className="py-3 pr-4">ポジション</th>
                    <th className="py-3 pr-4">種別</th>
                    <th className="py-3 pr-4">ステータス</th>
                    <th className="py-3 pr-4">優先度</th>
                    <th className="py-3 pr-4">次の予定</th>
                    <th className="py-3 pr-4">期限</th>
                    <th className="py-3 pr-4">更新日</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => {
                    const nextInterview = application.stages
                      .flatMap((stage) => stage.interviews)
                      .find((interview) => interview.confirmedStartAt);
                    const nextSlot = application.stages
                      .flatMap((stage) => stage.interviews)
                      .flatMap((interview) => interview.proposedSlots)
                      .find((slot) => slot.status === "PENDING");

                    return (
                      <tr key={application.id} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-semibold">
                          <Link href={`/applications/${application.id}`}>
                            {application.company.name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4">{application.position}</td>
                        <td className="py-3 pr-4">
                          {applicationTypeLabels[application.applicationType]}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge>{applicationStatusLabels[application.status]}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant="muted">{priorityLabels[application.priority]}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {nextInterview
                            ? formatTimeRange(
                                nextInterview.confirmedStartAt,
                                nextInterview.confirmedEndAt
                              )
                            : nextSlot
                              ? formatTimeRange(nextSlot.startAt, nextSlot.endAt)
                              : "-"}
                        </td>
                        <td className="py-3 pr-4">
                          {application.deadlines[0] ? formatDate(application.deadlines[0].dueAt) : "-"}
                        </td>
                        <td className="py-3 pr-4">{formatDate(application.updatedAt)}</td>
                      </tr>
                    );
                  })}
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
