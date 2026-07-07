"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  applicationRouteLabels,
  applicationStatusLabels,
  applicationTypeLabels,
  priorityLabels
} from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  applicationRouteValues,
  applicationSchema,
  applicationStatusValues,
  applicationTypeValues,
  priorityValues,
  type ApplicationInput
} from "@/features/applications/schema";
import { createApplication, updateApplication } from "@/features/applications/actions";

type ApplicationFormProps = {
  mode: "create" | "edit";
  application?: ApplicationInput & {
    id: string;
  };
};

export function ApplicationForm({ mode, application }: ApplicationFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ApplicationInput>({
    resolver: zodResolver(applicationSchema),
    defaultValues: application ?? {
      companyName: "",
      position: "",
      applicationType: "CAREER_CHANGE",
      route: "DIRECT",
      status: "DRAFT",
      priority: "MEDIUM",
      appliedAt: "",
      sourceUrl: "",
      note: ""
    }
  });

  const onSubmit = handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result =
        mode === "edit" && application
          ? await updateApplication(application.id, values)
          : await createApplication(values);

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      router.push(`/applications/${result.data?.id}`);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
        <Field label="ステータス" error={errors.status?.message}>
          <Select {...register("status")}>
            {applicationStatusValues.map((value) => (
              <option key={value} value={value}>
                {applicationStatusLabels[value]}
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
        <Field label="応募日" error={errors.appliedAt?.message}>
          <Input type="date" {...register("appliedAt")} />
        </Field>
        <Field label="求人URL" error={errors.sourceUrl?.message}>
          <Input type="url" placeholder="https://example.com/job" {...register("sourceUrl")} />
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
          {isPending ? "保存中" : mode === "create" ? "作成" : "更新"}
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
