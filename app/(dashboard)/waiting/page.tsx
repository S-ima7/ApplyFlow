import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSlotButton } from "@/features/interviews/components/confirm-slot-button";
import { getWaitingReplyItems } from "@/features/interviews/queries";
import { requireUser } from "@/lib/auth-guard";
import { formatTimeRange, daysUntil } from "@/lib/date";

export default async function WaitingPage() {
  const user = await requireUser();
  const interviews = await getWaitingReplyItems(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">返信待ち</h2>
        <p className="text-sm text-slate-500">返信待ちの面談と提示中候補日時を確認します。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>返信待ち一覧</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {interviews.length === 0 ? (
            <p className="text-sm text-slate-500">現在、返信待ちの選考はありません。</p>
          ) : null}
          {interviews.map((interview) => {
            const application = interview.selectionStage.application;
            return (
              <div key={interview.id} className="rounded-md border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/applications/${application.id}`}
                      className="font-semibold hover:underline"
                    >
                      {application.company.name}
                    </Link>
                    <p className="text-sm text-slate-500">
                      {application.position} / {interview.selectionStage.name ?? "選考"}
                    </p>
                  </div>
                  {application.deadlines[0] ? (
                    <Badge variant="warning">{daysUntil(application.deadlines[0].dueAt)}</Badge>
                  ) : (
                    <Badge variant="muted">期限なし</Badge>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {interview.proposedSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3"
                    >
                      <p className="text-sm">{formatTimeRange(slot.startAt, slot.endAt)}</p>
                      <ConfirmSlotButton proposedSlotId={slot.id} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
