"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { completeDeadline } from "@/features/applications/actions";

export function CompleteDeadlineButton({ deadlineId }: { deadlineId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await completeDeadline(deadlineId);
          router.refresh();
        });
      }}
    >
      {isPending ? "更新中" : "完了"}
    </Button>
  );
}
