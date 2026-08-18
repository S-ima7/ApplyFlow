import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClient } from "@/features/calendar/components/calendar-client";
import { GoogleCalendarBulkImportButton } from "@/features/calendar/components/google-calendar-bulk-import-button";
import { getCalendarData } from "@/features/calendar/queries";
import { getConflictAlertsForUser } from "@/features/conflict-detection/queries";
import { requireUser } from "@/lib/auth-guard";
import { formatTimeRange } from "@/lib/date";

export default async function CalendarPage() {
  const user = await requireUser();
  const [calendarData, conflicts] = await Promise.all([
    getCalendarData(user.id),
    getConflictAlertsForUser(user.id)
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">カレンダー</h2>
          <p className="text-sm text-slate-500">
            選考予定とGoogle Calendarを重ねて確認し、必要な予定を取り込めます。
          </p>
        </div>
        {calendarData.googleCalendar.status === "connected" ? (
          <GoogleCalendarBulkImportButton />
        ) : null}
      </div>
      {calendarData.googleCalendar.status !== "connected" ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-3 p-4 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">Google Calendarを取得できません</p>
              <p>
                {calendarData.googleCalendar.message ??
                  "Google Calendarの連携設定を確認してください。"}
              </p>
            </div>
            {calendarData.googleCalendar.message?.includes("Google Cloud Console") ? (
              <a
                href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                target="_blank"
                rel="noreferrer"
                className="shrink-0 font-semibold text-amber-950 underline underline-offset-4"
              >
                Calendar APIを有効化
              </a>
            ) : (
              <Link
                href="/settings"
                className="shrink-0 font-semibold text-amber-950 underline underline-offset-4"
              >
                連携設定を確認
              </Link>
            )}
          </CardContent>
        </Card>
      ) : null}
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
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
            <Legend className="bg-blue-600" label="確定面談" />
            <Legend className="border border-dashed border-blue-400 bg-blue-50" label="候補日時" />
            <Legend className="bg-violet-600" label="取込済み" />
            <Legend className="bg-slate-300" label="Google予定" />
            <Legend className="bg-amber-400" label="期限" />
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
          <CalendarClient
            events={calendarData.events}
            applicationOptions={calendarData.applicationOptions}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function getConflictHref(conflict: Awaited<ReturnType<typeof getConflictAlertsForUser>>[number]) {
  const applicationId = conflict.itemA.applicationId ?? conflict.itemB.applicationId;
  return applicationId ? `/applications/${applicationId}` : "/calendar";
}
