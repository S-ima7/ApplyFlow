"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getEmailImportJobResult,
  importAndExtractEmail
} from "@/features/email-import/actions";
import type { GmailMessageSummary } from "@/lib/gmail";
import { formatDateTimeInTimezone } from "@/lib/date";

type EmailMessageListProps = {
  messages: GmailMessageSummary[];
  timezone: string;
};

export function EmailMessageList({ messages, timezone }: EmailMessageListProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (messages.length === 0) {
    return <p className="text-sm text-slate-500">検索結果はありません。</p>;
  }

  return (
    <div className="space-y-3">
      {message ? (
        <div
          className={
            hasError
              ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              : "rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
          }
        >
          {message}
        </div>
      ) : null}
      {messages.map((mail) => (
        <div
          key={mail.id}
          className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 md:flex-row md:items-start md:justify-between"
        >
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-950">{mail.subject ?? "(件名なし)"}</p>
              <Badge variant="muted">
                {formatDateTimeInTimezone(mail.sentAt, timezone)}
              </Badge>
            </div>
            <p className="text-sm text-slate-600">{mail.fromAddress ?? "送信者不明"}</p>
            <p className="line-clamp-2 text-sm text-slate-500">{mail.snippet}</p>
          </div>
          <Button
            type="button"
            className="shrink-0"
            disabled={isPending}
            onClick={() => {
              setMessage(null);
              setHasError(false);
              setPendingId(mail.id);
              startTransition(async () => {
                try {
                  const result = await importAndExtractEmail(mail.id);

                  if (!result.ok) {
                    setHasError(true);
                    setMessage(result.message);
                    return;
                  }

                  if (!result.data?.jobId) {
                    setHasError(true);
                    setMessage("処理の受付結果を読み取れませんでした");
                    return;
                  }

                  setMessage("AIがメールを解析しています。このままお待ちください。");
                  for (let attempt = 0; attempt < 45; attempt += 1) {
                    const job = await getEmailImportJobResult(result.data.jobId);
                    if (!job.ok) {
                      setHasError(true);
                      setMessage(job.message);
                      return;
                    }
                    if (job.data?.status === "AUTO_APPLIED") {
                      router.push(`/applications/${job.data.applicationId}`);
                      router.refresh();
                      return;
                    }
                    if (job.data?.status === "REVIEW_REQUIRED") {
                      router.push(
                        `/email-import/${job.data.extractionId}/confirm`
                      );
                      router.refresh();
                      return;
                    }
                    await wait(2_000);
                  }

                  setMessage(
                    "処理はバックグラウンドで継続しています。結果は上の処理一覧に表示されます。"
                  );
                  router.refresh();
                } catch {
                  setHasError(true);
                  setMessage(
                    "処理状況を取得できませんでした。再読み込みして処理一覧を確認してください。"
                  );
                } finally {
                  setPendingId(null);
                }
              });
            }}
          >
            <Sparkles className="h-4 w-4" />
            {isPending && pendingId === mail.id ? "自動反映中" : "自動反映"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
