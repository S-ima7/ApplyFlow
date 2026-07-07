"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { interviewStatusLabels } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  interviewSchema,
  interviewStatusValues,
  type InterviewInput
} from "@/features/applications/schema";
import { createInterview } from "@/features/applications/actions";

export function InterviewForm({ selectionStageId }: { selectionStageId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<InterviewInput>({
    resolver: zodResolver(interviewSchema),
    defaultValues: {
      title: "",
      status: "DRAFT",
      meetingUrl: "",
      location: "",
      interviewerName: "",
      interviewerEmail: "",
      note: ""
    }
  });

  const onSubmit = handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await createInterview(selectionStageId, values);
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
        <Field label="面談タイトル" error={errors.title?.message}>
          <Input placeholder="一次面接など" {...register("title")} />
        </Field>
        <Field label="状態" error={errors.status?.message}>
          <Select {...register("status")}>
            {interviewStatusValues.map((value) => (
              <option key={value} value={value}>
                {interviewStatusLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="面談URL" error={errors.meetingUrl?.message}>
          <Input type="url" {...register("meetingUrl")} />
        </Field>
        <Field label="担当者" error={errors.interviewerName?.message}>
          <Input {...register("interviewerName")} />
        </Field>
      </div>
      <Field label="メモ" error={errors.note?.message}>
        <Textarea {...register("note")} />
      </Field>
      <Button type="submit" disabled={isPending} size="sm" variant="secondary">
        {isPending ? "追加中" : "面談追加"}
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
