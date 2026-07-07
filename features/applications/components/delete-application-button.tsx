"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteApplication } from "@/features/applications/actions";

export function DeleteApplicationButton({ applicationId }: { applicationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm("この応募先を削除しますか？")) {
          return;
        }
        startTransition(async () => {
          await deleteApplication(applicationId);
        });
      }}
    >
      {isPending ? "削除中" : "削除"}
    </Button>
  );
}
