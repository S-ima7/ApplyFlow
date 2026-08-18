import { createHash } from "node:crypto";
import { z } from "zod";
import { applicationTypeValues, stageTypeValues } from "@/features/applications/schema";
import { extractedConfirmedSlotSchema, extractedSlotSchema } from "@/features/email-import/schema";
import { normalizeSourceUrl } from "@/lib/source-url";

export const browserExtensionSourceSites = ["GREEN", "DODA", "RECRUIT_AGENT"] as const;
export const browserMessageEventTypes = ["CREATE_OR_UPDATE", "RESCHEDULE", "CANCEL"] as const;

const optionalCapturedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const browserExtensionLookupSchema = z.object({
  sourceSite: z.enum(browserExtensionSourceSites),
  sourceJobId: optionalCapturedText(200),
  sourceUrl: z.string().trim().url().max(2_000)
});

export const browserExtensionCaptureSchema = browserExtensionLookupSchema.extend({
  companyName: z.string().trim().min(1).max(100),
  position: z.string().trim().min(1).max(100),
  applicationType: z.enum(applicationTypeValues).default("CAREER_CHANGE"),
  locationText: optionalCapturedText(500),
  employmentTypeText: optionalCapturedText(300),
  compensationText: optionalCapturedText(500),
  note: optionalCapturedText(5_000),
  capturedAt: z.string().datetime({ offset: true }),
  adapterVersion: z.string().trim().min(1).max(50)
});

export const browserMessageExtractionRequestSchema = browserExtensionLookupSchema
  .omit({ sourceJobId: true })
  .extend({
    selectedText: z.string().trim().min(20).max(12_000),
    pageTitle: optionalCapturedText(300),
    capturedAt: z.string().datetime({ offset: true }),
    consentToAiProcessing: z.literal(true)
  });

export const browserMessageRegistrationSchema = browserExtensionLookupSchema
  .omit({ sourceJobId: true })
  .extend({
    messageDigest: z.string().regex(/^[a-f0-9]{64}$/),
    applicationId: optionalCapturedText(100),
    companyId: optionalCapturedText(100),
    companyName: z.string().trim().min(1).max(100),
    position: z.string().trim().min(1).max(100),
    applicationType: z.enum(applicationTypeValues).default("CAREER_CHANGE"),
    targetInterviewId: optionalCapturedText(100),
    eventType: z.enum(browserMessageEventTypes),
    stageType: z.enum(stageTypeValues).default("OTHER"),
    stageName: optionalCapturedText(100),
    confirmedSlot: extractedConfirmedSlotSchema,
    proposedSlots: z.array(extractedSlotSchema).max(10),
    meetingUrl: z.string().trim().url().max(2_000).nullable(),
    interviewerName: z.string().trim().max(200).nullable(),
    replaceCurrentSchedule: z.boolean().default(true)
  })
  .superRefine((data, ctx) => {
    const hasConfirmedSlot = Boolean(data.confirmedSlot.startAt && data.confirmedSlot.endAt);

    if (data.eventType === "CANCEL" && !data.targetInterviewId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "取消対象の面接を選択してください",
        path: ["targetInterviewId"]
      });
    }

    if (data.eventType === "RESCHEDULE" && !data.targetInterviewId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "変更対象の面接を選択してください",
        path: ["targetInterviewId"]
      });
    }

    if (data.eventType !== "CREATE_OR_UPDATE" && !data.applicationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "変更・取消対象の応募先を選択してください",
        path: ["applicationId"]
      });
    }

    if (data.eventType !== "CANCEL" && !hasConfirmedSlot && data.proposedSlots.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "確定日時または候補日時を1件以上入力してください",
        path: ["proposedSlots"]
      });
    }
  });

export type BrowserExtensionLookupInput = z.infer<typeof browserExtensionLookupSchema>;
export type BrowserExtensionCaptureInput = z.infer<typeof browserExtensionCaptureSchema>;
export type BrowserMessageExtractionRequestInput = z.infer<
  typeof browserMessageExtractionRequestSchema
>;
export type BrowserMessageRegistrationInput = z.infer<
  typeof browserMessageRegistrationSchema
>;

export function normalizeCapturedUrl(value: string) {
  return normalizeSourceUrl(value);
}

export function validateSourceHost(sourceSite: BrowserExtensionLookupInput["sourceSite"], value: string) {
  const hostname = new URL(value).hostname.toLowerCase();

  if (sourceSite === "GREEN") {
    return hostname === "green-japan.com" || hostname.endsWith(".green-japan.com");
  }

  if (sourceSite === "DODA") {
    return hostname === "doda.jp" || hostname.endsWith(".doda.jp");
  }

  return hostname === "r-agent.com" || hostname.endsWith(".r-agent.com");
}

export function validateCaptureSourceHost(
  sourceSite: BrowserExtensionLookupInput["sourceSite"],
  value: string
) {
  if (sourceSite !== "RECRUIT_AGENT") return validateSourceHost(sourceSite, value);
  return new URL(value).hostname.toLowerCase() === "www.r-agent.com";
}

export function buildBrowserExtensionSourceKey(input: BrowserExtensionLookupInput) {
  const normalizedUrl = normalizeCapturedUrl(input.sourceUrl);
  const identity = input.sourceJobId ? `job:${input.sourceJobId}` : `url:${normalizedUrl}`;
  const digest = createHash("sha256").update(`${input.sourceSite}:${identity}`).digest("hex");

  return `${input.sourceSite}:${digest}`;
}

export function buildBrowserMessageDigest(sourceSite: string, selectedText: string) {
  return createHash("sha256")
    .update(`${sourceSite}\0${selectedText.trim()}`)
    .digest("hex");
}
