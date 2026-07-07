"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  proposedSlotSchema,
  type ProposedSlotInput
} from "@/features/applications/schema";
import { createProposedSlot } from "@/features/applications/actions";

export function ProposedSlotForm({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<ProposedSlotInput>({
    resolver: zodResolver(proposedSlotSchema),
    defaultValues: {
      startAt: "",
      endAt: "",
      timezone: "Asia/Tokyo",
      note: ""
    }
  });

  const onSubmit = handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await createProposedSlot(interviewId, values);
      setMessage(result.message ?? null);
      if (!result.ok) {
        return;
      }
      reset();
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-dashed border-slate-300 p-3">
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="開始日時" error={errors.startAt?.message}>
          <Input type="datetime-local" {...register("startAt")} />
        </Field>
        <Field label="終了日時" error={errors.endAt?.message}>
          <Input type="datetime-local" {...register("endAt")} />
        </Field>
      </div>
      <Field label="メモ" error={errors.note?.message}>
        <Textarea {...register("note")} />
      </Field>
      <Button type="submit" disabled={isPending} size="sm" variant="secondary">
        {isPending ? "追加中" : "候補日時追加"}
      </Button>
    </form>
  );
}

function Field({
  label,
  error,
  children
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
