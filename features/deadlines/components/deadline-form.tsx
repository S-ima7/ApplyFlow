"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { deadlineTypeLabels } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  deadlineSchema,
  deadlineTypeValues,
  type DeadlineInput
} from "@/features/applications/schema";
import { createDeadline } from "@/features/applications/actions";

export function DeadlineForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<DeadlineInput>({
    resolver: zodResolver(deadlineSchema),
    defaultValues: {
      type: "REPLY_DEADLINE",
      title: "",
      dueAt: "",
      note: ""
    }
  });

  const onSubmit = handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await createDeadline(applicationId, values);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      reset();
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="期限種別" error={errors.type?.message}>
          <Select {...register("type")}>
            {deadlineTypeValues.map((value) => (
              <option key={value} value={value}>
                {deadlineTypeLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="期限タイトル" error={errors.title?.message}>
          <Input {...register("title")} />
        </Field>
        <Field label="期限日時" error={errors.dueAt?.message}>
          <Input type="datetime-local" {...register("dueAt")} />
        </Field>
      </div>
      <Field label="メモ" error={errors.note?.message}>
        <Textarea {...register("note")} />
      </Field>
      <Button type="submit" disabled={isPending} size="sm" variant="secondary">
        {isPending ? "追加中" : "期限追加"}
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
