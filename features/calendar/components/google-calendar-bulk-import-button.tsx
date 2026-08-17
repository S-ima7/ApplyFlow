"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  importAllGoogleCalendarEvents,
  type CalendarBulkImportActionResult
} from "@/features/calendar/actions";
import { cn } from "@/lib/utils";

export function GoogleCalendarBulkImportButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CalendarBulkImportActionResult | null>(
    null
  );

  return (
    <div className="space-y-2 sm:text-right">
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() => {
          if (
            !window.confirm(
              "今月から翌月末までのGoogle Calendar予定を一括取り込みします。既存予定は最新情報へ更新され、削除済みの同じ予定は再表示されます。"
            )
          ) {
            return;
          }

          setResult(null);
          startTransition(async () => {
            try {
              const result = await importAllGoogleCalendarEvents();
              setResult(result);

              if (result.ok) {
                router.refresh();
              }
            } catch {
              setResult({
                ok: false,
                message: "Google Calendar予定の一括取り込みに失敗しました"
              });
            }
          });
        }}
      >
        {isPending ? "一括取り込み中…" : "Google予定を一括取り込み"}
      </Button>
      {result ? (
        <p
          className={cn(
            "max-w-md rounded-md px-3 py-2 text-left text-xs",
            result.ok
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-700"
          )}
          role="status"
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
