import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeadlineForm } from "@/features/deadlines/components/deadline-form";
import { CompleteDeadlineButton } from "@/features/deadlines/components/complete-deadline-button";
import { StageForm } from "@/features/applications/components/stage-form";
import { InterviewForm } from "@/features/interviews/components/interview-form";
import { ProposedSlotForm } from "@/features/interviews/components/proposed-slot-form";
import { ConfirmSlotButton } from "@/features/interviews/components/confirm-slot-button";
import { GoogleCalendarRegisterButton } from "@/features/interviews/components/google-calendar-register-button";
import { getApplicationDetail } from "@/features/applications/queries";
import { requireUser } from "@/lib/auth-guard";
import { formatDateTime, formatTimeRange, daysUntil } from "@/lib/date";
import {
  applicationRouteLabels,
  applicationStatusLabels,
  applicationTypeLabels,
  deadlineStatusLabels,
  deadlineTypeLabels,
  interviewStatusLabels,
  priorityLabels,
  proposedSlotStatusLabels,
  stageStatusLabels,
  stageTypeLabels
} from "@/lib/labels";

export default async function ApplicationDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const application = await getApplicationDetail(user.id, id);

  if (!application) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">{application.company.name}</h2>
          <p className="text-sm text-slate-500">{application.position}</p>
        </div>
        <Link
          href={`/applications/${application.id}/edit`}
          className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          編集
        </Link>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-4">
          <Metric label="ステータス" value={applicationStatusLabels[application.status]} />
          <Metric label="優先度" value={priorityLabels[application.priority]} />
          <Metric label="応募種別" value={applicationTypeLabels[application.applicationType]} />
          <Metric label="応募経路" value={applicationRouteLabels[application.route]} />
        </CardContent>
      </Card>

      {application.sourceUrl ||
      application.locationText ||
      application.employmentTypeText ||
      application.compensationText ? (
        <Card>
          <CardHeader>
            <CardTitle>求人情報</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="勤務地" value={application.locationText ?? "-"} />
            <Metric label="雇用形態" value={application.employmentTypeText ?? "-"} />
            <Metric label="給与・報酬" value={application.compensationText ?? "-"} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">取得元</p>
              {application.sourceUrl ? (
                <a
                  href={application.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm font-semibold text-blue-600 hover:underline"
                >
                  {application.sourceSite ?? "求人ページ"}を開く
                </a>
              ) : (
                <p className="mt-1 text-sm font-semibold text-slate-950">-</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>選考タイムライン</CardTitle>
            </CardHeader>
            <CardContent>
              {application.stages.length === 0 ? (
                <p className="text-sm text-slate-500">選考フェーズはまだありません。</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {application.stages.map((stage) => (
                    <div key={stage.id} className="rounded-md border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            {stage.name ?? stageTypeLabels[stage.type]}
                          </p>
                          <p className="text-xs text-slate-500">{stageTypeLabels[stage.type]}</p>
                        </div>
                        <Badge variant={stage.status === "COMPLETED" ? "success" : "muted"}>
                          {stageStatusLabels[stage.status]}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        予定 {formatDateTime(stage.scheduledAt)} / 完了{" "}
                        {formatDateTime(stage.completedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>選考フェーズ追加</CardTitle>
            </CardHeader>
            <CardContent>
              <StageForm applicationId={application.id} />
            </CardContent>
          </Card>

          <div className="space-y-4">
            {application.stages.map((stage) => (
              <Card key={stage.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle>{stage.name ?? stageTypeLabels[stage.type]}</CardTitle>
                    <Badge variant="muted">{stageStatusLabels[stage.status]}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <InterviewForm selectionStageId={stage.id} />
                  {stage.interviews.length === 0 ? (
                    <p className="text-sm text-slate-500">面談はまだありません。</p>
                  ) : null}
                  {stage.interviews.map((interview) => (
                    <div key={interview.id} className="rounded-md border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            {interview.title ?? stage.name ?? stageTypeLabels[stage.type]}
                          </p>
                          <p className="text-sm text-slate-500">
                            {interview.meetingUrl ? (
                              <a
                                href={interview.meetingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                面談URL
                              </a>
                            ) : (
                              "面談URL未登録"
                            )}
                          </p>
                        </div>
                        <Badge
                          variant={
                            interview.status === "CONFIRMED"
                              ? "success"
                              : interview.status === "WAITING_REPLY"
                                ? "warning"
                                : "muted"
                          }
                        >
                          {interviewStatusLabels[interview.status]}
                        </Badge>
                      </div>
                      {interview.confirmedStartAt ? (
                        <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                          確定 {formatTimeRange(interview.confirmedStartAt, interview.confirmedEndAt)}
                        </p>
                      ) : null}
                      {interview.status === "CONFIRMED" &&
                      interview.confirmedStartAt &&
                      interview.confirmedEndAt &&
                      interview.confirmedStartAt < interview.confirmedEndAt ? (
                        <div className="mt-3">
                          <GoogleCalendarRegisterButton interviewId={interview.id} />
                        </div>
                      ) : null}
                      <div className="mt-4 space-y-2">
                        <p className="text-sm font-semibold">候補日時</p>
                        {interview.proposedSlots.length === 0 ? (
                          <p className="text-sm text-slate-500">候補日時はまだありません。</p>
                        ) : null}
                        {interview.proposedSlots.map((slot) => (
                          <div
                            key={slot.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
                          >
                            <div>
                              <p className="text-sm font-medium">
                                {formatTimeRange(slot.startAt, slot.endAt)}
                              </p>
                              <p className="text-xs text-slate-500">{slot.note}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  slot.status === "CONFIRMED"
                                    ? "success"
                                    : slot.status === "PENDING"
                                      ? "warning"
                                      : "muted"
                                }
                              >
                                {proposedSlotStatusLabels[slot.status]}
                              </Badge>
                              {slot.status === "PENDING" ? (
                                <ConfirmSlotButton proposedSlotId={slot.id} />
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4">
                        <ProposedSlotForm interviewId={interview.id} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>期限</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DeadlineForm applicationId={application.id} />
              {application.deadlines.length === 0 ? (
                <p className="text-sm text-slate-500">期限はまだありません。</p>
              ) : null}
              {application.deadlines.map((deadline) => (
                <div key={deadline.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{deadline.title}</p>
                      <p className="text-xs text-slate-500">
                        {deadlineTypeLabels[deadline.type]} / {deadlineStatusLabels[deadline.status]}
                      </p>
                    </div>
                    <Badge variant={deadline.status === "DONE" ? "success" : "warning"}>
                      {daysUntil(deadline.dueAt)}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{formatDateTime(deadline.dueAt)}</p>
                  {deadline.status === "OPEN" ? (
                    <div className="mt-3">
                      <CompleteDeadlineButton deadlineId={deadline.id} />
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>メモ</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                {application.note || "メモはありません。"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>活動ログ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {application.activityLogs.length === 0 ? (
                <p className="text-sm text-slate-500">活動ログはまだありません。</p>
              ) : null}
              {application.activityLogs.map((log) => (
                <div key={log.id} className="border-b border-slate-100 pb-3 last:border-0">
                  <p className="text-sm font-medium">{log.message}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}
