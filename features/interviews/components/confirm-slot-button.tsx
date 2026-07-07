"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmProposedSlot } from "@/features/applications/actions";

export function ConfirmSlotButton({ proposedSlotId }: { proposedSlotId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm("この候補日時を確定しますか？")) {
            return;
          }
          startTransition(async () => {
            const result = await confirmProposedSlot(proposedSlotId);
            setMessage(result.message ?? null);
            if (result.ok) {
              router.refresh();
            }
          });
        }}
      >
        {isPending ? "確定中" : "確定"}
      </Button>
      {message ? <p className="text-xs text-slate-600">{message}</p> : null}
    </div>
  );
}
