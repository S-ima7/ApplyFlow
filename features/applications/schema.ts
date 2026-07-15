import { z } from "zod";

export const applicationTypeValues = [
  "JOB_HUNTING",
  "CAREER_CHANGE",
  "INTERNSHIP",
  "FREELANCE",
  "PART_TIME",
  "GRADUATE_SCHOOL",
  "OTHER"
] as const;

export const applicationRouteValues = [
  "DIRECT",
  "AGENT",
  "REFERRAL",
  "JOB_BOARD",
  "SCOUT",
  "SNS",
  "OTHER"
] as const;

export const applicationStatusValues = [
  "DRAFT",
  "APPLIED",
  "DOCUMENT_SCREENING",
  "INTERVIEWING",
  "OFFERED",
  "ACCEPTED",
  "DECLINED",
  "REJECTED",
  "WITHDRAWN",
  "CLOSED"
] as const;

export const priorityValues = ["LOW", "MEDIUM", "HIGH", "TOP"] as const;

export const stageTypeValues = [
  "DOCUMENT_SCREENING",
  "CASUAL_MEETING",
  "FIRST_INTERVIEW",
  "SECOND_INTERVIEW",
  "FINAL_INTERVIEW",
  "OFFER_MEETING",
  "CONDITION_MEETING",
  "ASSIGNMENT",
  "OTHER"
] as const;

export const stageStatusValues = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING_REPLY",
  "SCHEDULED",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED"
] as const;

export const interviewStatusValues = [
  "DRAFT",
  "PROPOSED",
  "WAITING_REPLY",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED"
] as const;

export const deadlineTypeValues = [
  "REPLY_DEADLINE",
  "OFFER_ACCEPTANCE",
  "DOCUMENT_SUBMISSION",
  "ASSIGNMENT_SUBMISSION",
  "INTERVIEW_PREPARATION",
  "OTHER"
] as const;

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.string().url("URL形式で入力してください").optional());

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

export const applicationSchema = z.object({
  companyName: z.string().trim().min(1, "会社名は必須です").max(100),
  position: z.string().trim().min(1, "ポジションは必須です").max(100),
  applicationType: z.enum(applicationTypeValues),
  route: z.enum(applicationRouteValues),
  status: z.enum(applicationStatusValues).default("DRAFT"),
  priority: z.enum(priorityValues).default("MEDIUM"),
  appliedAt: optionalText,
  sourceUrl: optionalUrl,
  locationText: optionalText.pipe(z.string().max(500).optional()),
  employmentTypeText: optionalText.pipe(z.string().max(300).optional()),
  compensationText: optionalText.pipe(z.string().max(500).optional()),
  note: optionalText
});

export const stageSchema = z.object({
  type: z.enum(stageTypeValues),
  name: optionalText,
  status: z.enum(stageStatusValues).default("IN_PROGRESS"),
  scheduledAt: optionalText,
  completedAt: optionalText,
  note: optionalText
});

export const interviewSchema = z.object({
  title: optionalText,
  status: z.enum(interviewStatusValues).default("DRAFT"),
  meetingUrl: optionalUrl,
  location: optionalText,
  interviewerName: optionalText,
  interviewerEmail: optionalText.pipe(z.string().email("メール形式で入力してください").optional()),
  note: optionalText
});

export const proposedSlotSchema = z
  .object({
    startAt: z.string().min(1, "開始日時は必須です"),
    endAt: z.string().min(1, "終了日時は必須です"),
    timezone: z.string().default("Asia/Tokyo"),
    note: optionalText
  })
  .refine((data) => new Date(data.startAt) < new Date(data.endAt), {
    message: "終了日時は開始日時より後にしてください",
    path: ["endAt"]
  });

export const deadlineSchema = z.object({
  type: z.enum(deadlineTypeValues),
  title: z.string().trim().min(1, "期限タイトルは必須です").max(100),
  dueAt: z.string().min(1, "期限日時は必須です"),
  note: optionalText
});

export type ApplicationInput = z.infer<typeof applicationSchema>;
export type StageInput = z.infer<typeof stageSchema>;
export type InterviewInput = z.infer<typeof interviewSchema>;
export type ProposedSlotInput = z.infer<typeof proposedSlotSchema>;
export type DeadlineInput = z.infer<typeof deadlineSchema>;
