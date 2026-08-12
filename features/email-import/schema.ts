import { z } from "zod";
import {
  applicationRouteValues,
  applicationTypeValues,
  priorityValues,
  stageTypeValues
} from "@/features/applications/schema";
import { parseDateTimeInTimezone } from "@/lib/date";

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

export const emailExtractionEventTypes = [
  "CREATE_OR_UPDATE",
  "RESCHEDULE",
  "CANCEL",
  "INFORMATION_ONLY"
] as const;

export const emailExtractionFieldKeys = [
  "relevant",
  "eventType",
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

const emailExtractionCoreSchema = z.object({
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
  confidence: z.number().min(0).max(1)
});

/**
 * Stored results created before automated monitoring did not include decision fields.
 * Defaults keep those records readable while new provider responses use the strict schema below.
 */
export const emailExtractionSchema = emailExtractionCoreSchema.extend({
  relevant: z.boolean().default(true),
  eventType: z.enum(emailExtractionEventTypes).default("CREATE_OR_UPDATE"),
  fieldConfidence: fieldConfidenceSchema.partial().optional(),
  evidence: extractionEvidenceSchema.partial().optional()
});

export const emailAiExtractionSchema = emailExtractionCoreSchema.extend({
  relevant: z.boolean(),
  eventType: z.enum(emailExtractionEventTypes),
  fieldConfidence: fieldConfidenceSchema,
  evidence: extractionEvidenceSchema
});

export type EmailAiExtraction = z.infer<typeof emailAiExtractionSchema>;

export function recoverEmailAiExtraction(
  value: unknown,
  options: {
    timezone: string;
    eventTypes?: readonly EmailAiExtraction["eventType"][];
    fallbackEventType?: EmailAiExtraction["eventType"];
  }
): EmailAiExtraction | undefined {
  if (!isRecord(value)) return undefined;

  const normalizedEnvelope = normalizeKnownFieldEnvelopes(value, options);
  if (normalizedEnvelope) return normalizedEnvelope;

  const eventTypes = options.eventTypes ?? emailExtractionEventTypes;
  const eventType = eventTypes.includes(
    value.eventType as EmailAiExtraction["eventType"]
  )
    ? (value.eventType as EmailAiExtraction["eventType"])
    : (options.fallbackEventType ?? "INFORMATION_ONLY");
  const stageType = stageTypeValues.includes(
    value.stageType as (typeof stageTypeValues)[number]
  )
    ? (value.stageType as (typeof stageTypeValues)[number])
    : null;
  const recovered = {
    relevant: typeof value.relevant === "boolean" ? value.relevant : false,
    eventType,
    companyName: nullableText(value.companyName),
    position: nullableText(value.position),
    stageType,
    stageName: nullableText(value.stageName),
    proposedSlots: recoverSlots(value.proposedSlots, options.timezone),
    confirmedSlot: recoverConfirmedSlot(
      value.confirmedSlot,
      options.timezone,
      isRecord(value.evidence) ? value.evidence.confirmedSlot : null
    ),
    replyDeadline: recoverDateTime(value.replyDeadline, options.timezone),
    offerAcceptanceDeadline: recoverDateTime(
      value.offerAcceptanceDeadline,
      options.timezone
    ),
    meetingUrl: nullableText(value.meetingUrl),
    interviewerName: nullableText(value.interviewerName),
    confidence: 0,
    fieldConfidence: Object.fromEntries(
      emailExtractionFieldKeys.map((key) => [key, 0])
    ),
    evidence: Object.fromEntries(
      emailExtractionFieldKeys.map((key) => [
        key,
        isRecord(value.evidence) ? nullableText(value.evidence[key]) : null
      ])
    )
  };
  if (!hasRecoverableExtractionContent(recovered)) return undefined;
  const parsed = emailAiExtractionSchema.safeParse(recovered);
  return parsed.success ? parsed.data : undefined;
}

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

function recoverSlots(value: unknown, timezone: string) {
  value = unwrapKnownFieldEnvelope(value).value;
  if (!Array.isArray(value)) return [];

  return value
    .map((slot) => recoverSlot(slot, timezone))
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null)
    .slice(0, 10);
}

function recoverConfirmedSlot(
  value: unknown,
  timezone: string,
  evidence: unknown = null
) {
  value = unwrapKnownFieldEnvelope(value).value;
  if (typeof value === "string") {
    value = parseJsonRecord(value) ?? recoverJapaneseDateRange(value, timezone);
  }
  if (!isRecord(value)) {
    const fromEvidence = recoverJapaneseDateRange(evidence, timezone);
    if (fromEvidence) return fromEvidence;
  }
  if (!isRecord(value)) {
    return { startAt: null, endAt: null, timezone: null };
  }

  const startAt = recoverDateTime(value.startAt, timezone);
  const endAt = recoverDateTime(value.endAt, timezone);
  if (!startAt && !endAt) {
    return { startAt: null, endAt: null, timezone: null };
  }
  if (!startAt || !endAt || new Date(startAt) >= new Date(endAt)) {
    return { startAt: null, endAt: null, timezone: null };
  }

  return {
    startAt,
    endAt,
    timezone: nullableText(value.timezone) ?? timezone
  };
}

function recoverSlot(value: unknown, timezone: string) {
  value = unwrapKnownFieldEnvelope(value).value;
  if (typeof value === "string") value = parseJsonRecord(value);
  if (!isRecord(value)) return null;

  const startAt = recoverDateTime(value.startAt, timezone);
  const endAt = recoverDateTime(value.endAt, timezone);
  if (!startAt || !endAt || new Date(startAt) >= new Date(endAt)) return null;

  return {
    startAt,
    endAt,
    timezone: nullableText(value.timezone) ?? timezone
  };
}

function recoverDateTime(value: unknown, timezone: string) {
  value = unwrapKnownFieldEnvelope(value).value;
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;
  if (hasExplicitTimezone(normalized)) {
    return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
  }

  return parseDateTimeInTimezone(normalized, timezone)?.toISOString() ?? null;
}

function nullableText(value: unknown) {
  value = unwrapKnownFieldEnvelope(value).value;
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function normalizeKnownFieldEnvelopes(
  value: Record<string, unknown>,
  options: {
    timezone: string;
    eventTypes?: readonly EmailAiExtraction["eventType"][];
    fallbackEventType?: EmailAiExtraction["eventType"];
  }
) {
  const fields = Object.fromEntries(
    emailExtractionFieldKeys.map((key) => [key, unwrapKnownFieldEnvelope(value[key])])
  ) as Record<
    (typeof emailExtractionFieldKeys)[number],
    ReturnType<typeof unwrapKnownFieldEnvelope>
  >;
  if (!Object.values(fields).some((field) => field.wrapped)) return undefined;

  const rawConfidence = isRecord(value.fieldConfidence)
    ? value.fieldConfidence
    : {};
  const rawEvidence = isRecord(value.evidence) ? value.evidence : {};
  const fieldConfidence = Object.fromEntries(
    emailExtractionFieldKeys.map((key) => [
      key,
      confidenceValue(rawConfidence[key]) ?? fields[key].confidence ?? 0
    ])
  );
  const evidence = Object.fromEntries(
    emailExtractionFieldKeys.map((key) => [
      key,
      nullableText(rawEvidence[key]) ?? fields[key].excerpt ?? null
    ])
  );
  const eventTypes = options.eventTypes ?? emailExtractionEventTypes;
  const eventType = eventTypes.includes(
    fields.eventType.value as EmailAiExtraction["eventType"]
  )
    ? (fields.eventType.value as EmailAiExtraction["eventType"])
    : (options.fallbackEventType ?? "INFORMATION_ONLY");
  const stageType = stageTypeValues.includes(
    fields.stageType.value as (typeof stageTypeValues)[number]
  )
    ? (fields.stageType.value as (typeof stageTypeValues)[number])
    : null;
  const confidence =
    confidenceValue(value.confidence) ??
    Math.min(...Object.values(fieldConfidence));
  const candidate = {
    relevant:
      typeof fields.relevant.value === "boolean" ? fields.relevant.value : false,
    eventType,
    companyName: nullableText(fields.companyName.value),
    position: nullableText(fields.position.value),
    stageType,
    stageName: nullableText(fields.stageName.value),
    proposedSlots: recoverSlots(fields.proposedSlots.value, options.timezone),
    confirmedSlot: recoverConfirmedSlot(
      fields.confirmedSlot.value,
      options.timezone,
      evidence.confirmedSlot
    ),
    replyDeadline: recoverDateTime(fields.replyDeadline.value, options.timezone),
    offerAcceptanceDeadline: recoverDateTime(
      fields.offerAcceptanceDeadline.value,
      options.timezone
    ),
    meetingUrl: nullableText(fields.meetingUrl.value),
    interviewerName: nullableText(fields.interviewerName.value),
    confidence,
    fieldConfidence,
    evidence
  };

  const parsed = emailAiExtractionSchema.safeParse(candidate);
  return parsed.success && hasRecoverableExtractionContent(parsed.data)
    ? parsed.data
    : undefined;
}

function unwrapKnownFieldEnvelope(value: unknown): {
  value: unknown;
  confidence?: number;
  excerpt?: string;
  wrapped: boolean;
} {
  const parsed =
    typeof value === "string" ? parseJsonRecord(value) ?? value : value;
  if (!isRecord(parsed) || !("value" in parsed)) {
    return { value, wrapped: false };
  }

  const allowedKeys = new Set(["value", "confidence", "excerpt"]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    return { value, wrapped: false };
  }

  return {
    value: parsed.value,
    confidence: confidenceValue(parsed.confidence) ?? undefined,
    excerpt: nullableText(parsed.excerpt) ?? undefined,
    wrapped: true
  };
}

function confidenceValue(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : null;
}

function parseJsonRecord(value: string) {
  const normalized = value.trim();
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return null;

  try {
    const parsed: unknown = JSON.parse(normalized);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function recoverJapaneseDateRange(value: unknown, timezone: string) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\([^)]*\))?\s+(\d{1,2}):(\d{2})\s*(?:-|–|〜|～|~)\s*(\d{1,2}):(\d{2})/
  );
  if (!match) return null;

  const [, year, month, day, startHour, startMinute, endHour, endMinute] =
    match;
  const [yearNumber, monthNumber, dayNumber, startHourNumber, startMinuteNumber, endHourNumber, endMinuteNumber] =
    [year, month, day, startHour, startMinute, endHour, endMinute].map(Number);
  const daysInMonth = new Date(
    Date.UTC(yearNumber, monthNumber, 0)
  ).getUTCDate();
  if (
    monthNumber < 1 || monthNumber > 12 ||
    dayNumber < 1 || dayNumber > daysInMonth ||
    startHourNumber > 23 || endHourNumber > 23 ||
    startMinuteNumber > 59 || endMinuteNumber > 59
  ) {
    return null;
  }
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const startAt = parseDateTimeInTimezone(
    `${date}T${startHour.padStart(2, "0")}:${startMinute}`,
    timezone
  );
  const endAt = parseDateTimeInTimezone(
    `${date}T${endHour.padStart(2, "0")}:${endMinute}`,
    timezone
  );
  if (!startAt || !endAt || startAt >= endAt) return null;

  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone
  };
}

function hasRecoverableExtractionContent(value: Record<string, unknown>) {
  const hasText = [
    "companyName",
    "position",
    "stageName",
    "replyDeadline",
    "offerAcceptanceDeadline",
    "meetingUrl",
    "interviewerName"
  ].some((key) => nullableText(value[key]) !== null);
  const hasProposedSlots =
    Array.isArray(value.proposedSlots) && value.proposedSlots.length > 0;
  const hasConfirmedSlot =
    isRecord(value.confirmedSlot) &&
    Boolean(value.confirmedSlot.startAt || value.confirmedSlot.endAt);

  return hasText || hasProposedSlots || hasConfirmedSlot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
