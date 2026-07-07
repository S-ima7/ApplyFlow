"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { stageStatusLabels, stageTypeLabels } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  stageSchema,
  stageStatusValues,
  stageTypeValues,
  type StageInput
} from "@/features/applications/schema";
import { createSelectionStage } from "@/features/applications/actions";

export function StageForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<StageInput>({
    resolver: zodResolver(stageSchema),
    defaultValues: {
      type: "FIRST_INTERVIEW",
      name: "",
      status: "IN_PROGRESS",
      scheduledAt: "",
      completedAt: "",
      note: ""
    }
  });

  const onSubmit = handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await createSelectionStage(applicationId, values);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      reset();
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="フェーズ種別" error={errors.type?.message}>
          <Select {...register("type")}>
            {stageTypeValues.map((value) => (
              <option key={value} value={value}>
                {stageTypeLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="状態" error={errors.status?.message}>
          <Select {...register("status")}>
            {stageStatusValues.map((value) => (
              <option key={value} value={value}>
                {stageStatusLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="表示名" error={errors.name?.message}>
        <Input placeholder="技術面接、人事面談など" {...register("name")} />
      </Field>
      <Field label="メモ" error={errors.note?.message}>
        <Textarea {...register("note")} />
      </Field>
      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "追加中" : "フェーズ追加"}
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
