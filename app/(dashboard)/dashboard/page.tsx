import Link from "next/link";
import { AlertTriangle, BriefcaseBusiness, CalendarDays, Clock3, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/features/applications/queries";
import { getConflictAlertsForUser } from "@/features/conflict-detection/queries";
import { requireUser } from "@/lib/auth-guard";
import { formatTimeRange, daysUntil } from "@/lib/date";

export default async function DashboardPage() {
  const user = await requireUser();
  const [dashboard, conflicts] = await Promise.all([
    getDashboardData(user.id),
    getConflictAlertsForUser(user.id)
  ]);

  const summary = [
    {
      label: "今週の面談",
      value: dashboard.weeklyInterviews.length,
      icon: CalendarDays
    },
    {
      label: "返信待ち",
      value: dashboard.waitingInterviews.length,
      icon: Clock3
    },
    {
      label: "期限間近",
      value: dashboard.upcomingDeadlines.length,
      icon: Timer
    },
    {
      label: "衝突",
      value: conflicts.length,
      icon: AlertTriangle
    },
    {
      label: "進行中応募",
      value: dashboard.activeApplications,
      icon: BriefcaseBusiness
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">Dashboard</h2>
          <p className="text-sm text-slate-500">今日と今週の対応事項を確認します。</p>
        </div>
        <Link
          href="/applications/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          新規応募
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {summary.map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-slate-500">{item.label}</p>
                <p className="text-3xl font-bold">{item.value}</p>
              </div>
              <item.icon className="h-6 w-6 text-blue-600" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today / This Week</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...dashboard.weeklyInterviews, ...dashboard.weeklyProposedSlots].length === 0 ? (
              <p className="text-sm text-slate-500">今週の面談・候補日時はありません。</p>
            ) : null}
            {dashboard.weeklyInterviews.map((interview) => {
              const application = interview.selectionStage.application;
              return (
                <Link
                  key={interview.id}
                  href={`/applications/${application.id}`}
                  className="block rounded-md border border-slate-200 p-3 hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{application.company.name}</p>
                      <p className="text-sm text-slate-500">{application.position}</p>
                    </div>
                    <Badge variant="success">確定</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {formatTimeRange(interview.confirmedStartAt, interview.confirmedEndAt)}
                  </p>
                </Link>
              );
            })}
            {dashboard.weeklyProposedSlots.map((slot) => {
              const application = slot.interview.selectionStage.application;
              return (
                <Link
                  key={slot.id}
                  href={`/applications/${application.id}`}
                  className="block rounded-md border border-dashed border-slate-300 p-3 hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{application.company.name}</p>
                      <p className="text-sm text-slate-500">{application.position}</p>
                    </div>
                    <Badge variant="muted">候補</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {formatTimeRange(slot.startAt, slot.endAt)}
                  </p>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Waiting Reply</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.waitingInterviews.length === 0 ? (
              <p className="text-sm text-slate-500">現在、返信待ちの選考はありません。</p>
            ) : null}
            {dashboard.waitingInterviews.map((interview) => {
              const application = interview.selectionStage.application;
              return (
                <Link
                  key={interview.id}
                  href={`/applications/${application.id}`}
                  className="block rounded-md border border-slate-200 p-3 hover:bg-slate-50"
                >
                  <p className="font-semibold">{application.company.name}</p>
                  <p className="text-sm text-slate-500">{application.position}</p>
                  <p className="mt-2 text-sm text-slate-700">
                    候補 {interview.proposedSlots.length}件
                  </p>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Deadlines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.upcomingDeadlines.length === 0 ? (
              <p className="text-sm text-slate-500">期限はありません。</p>
            ) : null}
            {dashboard.upcomingDeadlines.map((deadline) => (
              <Link
                key={deadline.id}
                href={`/applications/${deadline.applicationId}`}
                className="block rounded-md border border-slate-200 p-3 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{deadline.title}</p>
                    <p className="text-sm text-slate-500">
                      {deadline.application.company.name} / {deadline.application.position}
                    </p>
                  </div>
                  <Badge variant="warning">{daysUntil(deadline.dueAt)}</Badge>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conflict Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conflicts.length === 0 ? (
              <p className="text-sm text-slate-500">現在、日程衝突はありません。</p>
            ) : null}
            {conflicts.slice(0, 8).map((conflict) => (
              <Link
                key={conflict.id}
                href={`/applications/${conflict.itemA.applicationId}`}
                className="block rounded-md border border-amber-200 bg-amber-50 p-3 text-sm"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-amber-900">
                    {conflict.itemA.companyName} / {conflict.itemB.companyName}
                  </span>
                  <Badge
                    variant={
                      conflict.severity === "high"
                        ? "danger"
                        : conflict.severity === "medium"
                          ? "warning"
                          : "muted"
                    }
                  >
                    {conflict.severity}
                  </Badge>
                </div>
                <p className="text-amber-900">
                  {formatTimeRange(conflict.startsAt, conflict.endsAt)}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
