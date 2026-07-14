"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  applicationRouteLabels,
  applicationTypeLabels,
  priorityLabels,
  stageTypeLabels
} from "@/lib/labels";
import {
  applicationRouteValues,
  applicationTypeValues,
  priorityValues,
  stageTypeValues
} from "@/features/applications/schema";
import { confirmEmailImportRegistration } from "@/features/email-import/actions";
import {
  emailImportConfirmSchema,
  type EmailImportConfirmInput
} from "@/features/email-import/schema";

type EmailImportConfirmFormProps = {
  extractionResultId: string;
  defaultValues: EmailImportConfirmInput;
};

export function EmailImportConfirmForm({
  extractionResultId,
  defaultValues
}: EmailImportConfirmFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors }
  } = useForm<EmailImportConfirmInput>({
    resolver: zodResolver(emailImportConfirmSchema),
    defaultValues
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "proposedSlots"
  });

  const onSubmit = handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await confirmEmailImportRegistration(extractionResultId, values);

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      if (!result.data?.applicationId) {
        setMessage("登録結果を読み取れませんでした");
        return;
      }

      router.push(`/applications/${result.data.applicationId}`);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="会社名" error={errors.companyName?.message}>
          <Input {...register("companyName")} />
        </Field>
        <Field label="ポジション" error={errors.position?.message}>
          <Input {...register("position")} />
        </Field>
        <Field label="応募種別" error={errors.applicationType?.message}>
          <Select {...register("applicationType")}>
            {applicationTypeValues.map((value) => (
              <option key={value} value={value}>
                {applicationTypeLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="応募経路" error={errors.route?.message}>
          <Select {...register("route")}>
            {applicationRouteValues.map((value) => (
              <option key={value} value={value}>
                {applicationRouteLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="優先度" error={errors.priority?.message}>
          <Select {...register("priority")}>
            {priorityValues.map((value) => (
              <option key={value} value={value}>
                {priorityLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="選考フェーズ" error={errors.stageType?.message}>
          <Select {...register("stageType")}>
            {stageTypeValues.map((value) => (
              <option key={value} value={value}>
                {stageTypeLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="フェーズ表示名" error={errors.stageName?.message}>
        <Input placeholder="一次面接、人事面談など" {...register("stageName")} />
      </Field>

      <div className="rounded-md border border-slate-200 p-4">
        <div className="mb-4">
          <p className="font-semibold text-slate-950">確定日時</p>
          <p className="text-sm text-slate-500">確定済み日程がメールに含まれている場合に使います。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="開始" error={errors.confirmedStartAt?.message}>
            <Input type="datetime-local" {...register("confirmedStartAt")} />
          </Field>
          <Field label="終了" error={errors.confirmedEndAt?.message}>
            <Input type="datetime-local" {...register("confirmedEndAt")} />
          </Field>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-950">候補日時</p>
            <p className="text-sm text-slate-500">提示中の候補日時として登録します。</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              append({
                startAt: "",
                endAt: "",
                timezone: "Asia/Tokyo",
                note: ""
              })
            }
          >
            <Plus className="h-4 w-4" />
            追加
          </Button>
        </div>
        <div className="space-y-4">
          {fields.length === 0 ? (
            <p className="text-sm text-slate-500">候補日時はありません。</p>
          ) : null}
          {fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 rounded-md bg-slate-50 p-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <Field
                  label="開始"
                  error={errors.proposedSlots?.[index]?.startAt?.message}
                >
                  <Input
                    type="datetime-local"
                    {...register(`proposedSlots.${index}.startAt`)}
                  />
                </Field>
              </div>
              <div className="md:col-span-4">
                <Field label="終了" error={errors.proposedSlots?.[index]?.endAt?.message}>
                  <Input
                    type="datetime-local"
                    {...register(`proposedSlots.${index}.endAt`)}
                  />
                </Field>
              </div>
              <div className="md:col-span-3">
                <Field
                  label="タイムゾーン"
                  error={errors.proposedSlots?.[index]?.timezone?.message}
                >
                  <Input {...register(`proposedSlots.${index}.timezone`)} />
                </Field>
              </div>
              <div className="flex items-end md:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="候補日時を削除"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="返信期限" error={errors.replyDeadlineAt?.message}>
          <Input type="datetime-local" {...register("replyDeadlineAt")} />
        </Field>
        <Field label="承諾期限" error={errors.offerAcceptanceDeadlineAt?.message}>
          <Input type="datetime-local" {...register("offerAcceptanceDeadlineAt")} />
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

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          戻る
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "登録中" : "応募情報を登録"}
        </Button>
      </div>
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
