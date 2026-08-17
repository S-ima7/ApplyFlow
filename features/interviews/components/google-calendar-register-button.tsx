"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  registerConfirmedInterviewInGoogleCalendar,
  type CalendarExportActionResult
} from "@/features/calendar/actions";
import { cn } from "@/lib/utils";

export function GoogleCalendarRegisterButton({
  interviewId
}: {
  interviewId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CalendarExportActionResult | null>(null);
  const registered = result?.ok === true;
  const needsReauthentication =
    result?.ok === false &&
    (result.status === "missing_scope" || result.status === "reauth_required");

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={isPending || registered}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            setResult(
              await registerConfirmedInterviewInGoogleCalendar(interviewId)
            );
          });
        }}
      >
        {registered
          ? "Google Calendar登録済み"
          : isPending
            ? "登録中…"
            : "Google Calendarに登録"}
      </Button>

      {result ? (
        <div
          className={cn(
            "rounded-md px-3 py-2 text-xs",
            result.ok
              ? "bg-green-50 text-green-800"
              : needsReauthentication
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-700"
          )}
          role="status"
        >
          <p>{result.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {needsReauthentication ? (
              <Link
                href="/settings"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                設定で再ログイン
              </Link>
            ) : null}
            {result.ok && result.eventUrl ? (
              <a
                href={result.eventUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "bg-white"
                )}
              >
                <ExternalLink className="h-4 w-4" />
                Googleで開く
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
