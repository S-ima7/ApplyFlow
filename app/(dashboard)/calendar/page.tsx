import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClient } from "@/features/calendar/components/calendar-client";
import { getCalendarEvents } from "@/features/calendar/queries";
import { getConflictAlertsForUser } from "@/features/conflict-detection/queries";
import { requireUser } from "@/lib/auth-guard";
import { formatTimeRange } from "@/lib/date";

export default async function CalendarPage() {
  const user = await requireUser();
  const [events, conflicts] = await Promise.all([
    getCalendarEvents(user.id),
    getConflictAlertsForUser(user.id)
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">Calendar</h2>
        <p className="text-sm text-slate-500">
          確定面談、提示中候補日時、返信期限、承諾期限を時間軸で確認します。
        </p>
      </div>
      {conflicts.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle>衝突警告</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {conflicts.slice(0, 4).map((conflict) => (
              <Link
                key={conflict.id}
                href={getConflictHref(conflict)}
                className="rounded-md border border-amber-200 bg-white p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">
                    {conflict.itemA.companyName} / {conflict.itemB.companyName}
                  </p>
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
                <p className="mt-2 text-slate-600">
                  {formatTimeRange(conflict.startsAt, conflict.endsAt)}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="p-4">
          <CalendarClient events={events} />
        </CardContent>
      </Card>
    </div>
  );
}

function getConflictHref(conflict: Awaited<ReturnType<typeof getConflictAlertsForUser>>[number]) {
  const applicationId = conflict.itemA.applicationId ?? conflict.itemB.applicationId;
  return applicationId ? `/applications/${applicationId}` : "/calendar";
}
