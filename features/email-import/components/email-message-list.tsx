"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { importAndExtractEmail } from "@/features/email-import/actions";
import type { GmailMessageSummary } from "@/lib/gmail";
import { formatDateTime } from "@/lib/date";

type EmailMessageListProps = {
  messages: GmailMessageSummary[];
};

export function EmailMessageList({ messages }: EmailMessageListProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (messages.length === 0) {
    return <p className="text-sm text-slate-500">検索結果はありません。</p>;
  }

  return (
    <div className="space-y-3">
      {message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
              <Badge variant="muted">{formatDateTime(mail.sentAt)}</Badge>
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
              setPendingId(mail.id);
              startTransition(async () => {
                const result = await importAndExtractEmail(mail.id);

                if (!result.ok) {
                  setMessage(result.message);
                  setPendingId(null);
                  return;
                }

                if (!result.data?.extractionId) {
                  setMessage("抽出結果を読み取れませんでした");
                  setPendingId(null);
                  return;
                }

                router.push(`/email-import/${result.data.extractionId}/confirm`);
                router.refresh();
              });
            }}
          >
            <Sparkles className="h-4 w-4" />
            {isPending && pendingId === mail.id ? "抽出中" : "抽出"}
          </Button>
        </div>
      ))}
    </div>
  );
}
