import { z } from "zod";
import {
  applicationRouteValues,
  applicationTypeValues,
  priorityValues,
  stageTypeValues
} from "@/features/applications/schema";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.string().url("URL形式で入力してください").optional());

const isoDateTimeWithTimezone = z
  .string()
  .trim()
  .refine((value) => hasExplicitTimezone(value), {
    message: "タイムゾーン付きISO日時である必要があります"
  })
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "有効な日時である必要があります"
  });

const nullableString = z.string().trim().nullable();
const nullableIsoDateTime = isoDateTimeWithTimezone.nullable();

export const emailExtractionFieldKeys = [
  "companyName",
  "position",
  "stageType",
  "stageName",
  "proposedSlots",
  "confirmedSlot",
  "replyDeadline",
  "offerAcceptanceDeadline",
  "meetingUrl",
  "interviewerName"
] as const;

const fieldConfidenceSchema = z.object(
  Object.fromEntries(
    emailExtractionFieldKeys.map((key) => [key, z.number().min(0).max(1)])
  ) as Record<(typeof emailExtractionFieldKeys)[number], z.ZodNumber>
);

const extractionEvidenceSchema = z.object(
  Object.fromEntries(
    emailExtractionFieldKeys.map((key) => [key, z.string().trim().nullable()])
  ) as Record<
    (typeof emailExtractionFieldKeys)[number],
    z.ZodNullable<z.ZodString>
  >
);

export const extractedSlotSchema = z
  .object({
    startAt: isoDateTimeWithTimezone,
    endAt: isoDateTimeWithTimezone,
    timezone: nullableString
  })
  .refine((slot) => new Date(slot.startAt) < new Date(slot.endAt), {
    message: "終了日時は開始日時より後にしてください",
    path: ["endAt"]
  });

export const extractedConfirmedSlotSchema = z
  .object({
    startAt: nullableIsoDateTime,
    endAt: nullableIsoDateTime,
    timezone: nullableString
  })
  .refine(
    (slot) =>
      (!slot.startAt && !slot.endAt) ||
      (Boolean(slot.startAt) &&
        Boolean(slot.endAt) &&
        new Date(slot.startAt ?? "") < new Date(slot.endAt ?? "")),
    {
      message: "確定日時の終了は開始より後にしてください",
      path: ["endAt"]
    }
  );

export const emailExtractionSchema = z.object({
  companyName: nullableString,
  position: nullableString,
  stageType: z.enum(stageTypeValues).nullable(),
  stageName: nullableString,
  proposedSlots: z.array(extractedSlotSchema),
  confirmedSlot: extractedConfirmedSlotSchema,
  replyDeadline: nullableIsoDateTime,
  offerAcceptanceDeadline: nullableIsoDateTime,
  meetingUrl: nullableString,
  interviewerName: nullableString,
  confidence: z.number().min(0).max(1),
  fieldConfidence: fieldConfidenceSchema.optional(),
  evidence: extractionEvidenceSchema.optional()
});

const localDateTime = z.string().trim();
const optionalLocalDateTime = localDateTime.optional().transform((value) => value || undefined);

export const confirmProposedSlotSchema = z
  .object({
    startAt: localDateTime.min(1, "開始日時は必須です"),
    endAt: localDateTime.min(1, "終了日時は必須です"),
    timezone: z.string().trim().default("Asia/Tokyo"),
    note: optionalText
  })
  .refine((slot) => new Date(slot.startAt) < new Date(slot.endAt), {
    message: "終了日時は開始日時より後にしてください",
    path: ["endAt"]
  });

export const emailImportConfirmSchema = z
  .object({
    companyName: z.string().trim().min(1, "会社名は必須です").max(100),
    position: z.string().trim().min(1, "ポジションは必須です").max(100),
    applicationType: z.enum(applicationTypeValues).default("CAREER_CHANGE"),
    route: z.enum(applicationRouteValues).default("DIRECT"),
    priority: z.enum(priorityValues).default("MEDIUM"),
    stageType: z.enum(stageTypeValues).default("OTHER"),
    stageName: optionalText,
    confirmedStartAt: optionalLocalDateTime,
    confirmedEndAt: optionalLocalDateTime,
    proposedSlots: z.array(confirmProposedSlotSchema).default([]),
    replyDeadlineAt: optionalLocalDateTime,
    offerAcceptanceDeadlineAt: optionalLocalDateTime,
    meetingUrl: optionalUrl,
    interviewerName: optionalText,
    note: optionalText
  })
  .superRefine((data, ctx) => {
    validateOptionalRange(data.confirmedStartAt, data.confirmedEndAt, ctx);
    validateOptionalDate(data.replyDeadlineAt, ["replyDeadlineAt"], ctx);
    validateOptionalDate(data.offerAcceptanceDeadlineAt, ["offerAcceptanceDeadlineAt"], ctx);
  });

export type EmailExtraction = z.infer<typeof emailExtractionSchema>;
export type EmailExtractionFieldKey = (typeof emailExtractionFieldKeys)[number];
export type EmailImportConfirmInput = z.infer<typeof emailImportConfirmSchema>;

export function hasExplicitTimezone(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim());
}

function validateOptionalRange(
  startAt: string | undefined,
  endAt: string | undefined,
  ctx: z.RefinementCtx
) {
  if (!startAt && !endAt) {
    return;
  }

  if (!startAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "開始日時を入力してください",
      path: ["confirmedStartAt"]
    });
    return;
  }

  if (!endAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "終了日時を入力してください",
      path: ["confirmedEndAt"]
    });
    return;
  }

  if (!(new Date(startAt) < new Date(endAt))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "終了日時は開始日時より後にしてください",
      path: ["confirmedEndAt"]
    });
  }
}

function validateOptionalDate(
  value: string | undefined,
  path: string[],
  ctx: z.RefinementCtx
) {
  if (!value || !Number.isNaN(new Date(value).getTime())) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "有効な日時を入力してください",
    path
  });
}
