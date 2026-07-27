import { z } from "zod";
import { stageTypeValues } from "@/features/applications/schema";

const nullableDateTime = z.string().datetime({ offset: true }).nullable();

const slotSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  timezone: z.string().nullable()
});

export const emailMonitorExtractionSchema = z.object({
  relevant: z.boolean(),
  eventType: z.enum([
    "CREATE_OR_UPDATE",
    "RESCHEDULE",
    "CANCEL",
    "INFORMATION_ONLY"
  ]),
  companyName: z.string().nullable(),
  position: z.string().nullable(),
  stageType: z.enum(stageTypeValues).nullable(),
  stageName: z.string().nullable(),
  proposedSlots: z.array(slotSchema),
  confirmedSlot: z.object({
    startAt: nullableDateTime,
    endAt: nullableDateTime,
    timezone: z.string().nullable()
  }),
  replyDeadline: nullableDateTime,
  offerAcceptanceDeadline: nullableDateTime,
  meetingUrl: z.string().nullable(),
  interviewerName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1))
});

export type EmailMonitorExtraction = z.infer<typeof emailMonitorExtractionSchema>;

export type EmailMonitorAiResult =
  | {
      ok: true;
      data: EmailMonitorExtraction;
      metadata: {
        model: string;
        promptVersion: string;
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      };
    }
  | {
      ok: false;
      message: string;
      error?: {
        code: string;
        retryable: boolean;
      };
    };

export function normalizeEmailMonitorAiResult(value: unknown): EmailMonitorAiResult {
  if (!value || typeof value !== "object" || !("ok" in value)) {
    return { ok: false, message: "AI抽出結果の形式が不正です" };
  }

  const result = value as {
    ok: unknown;
    data?: unknown;
    message?: unknown;
    error?: {
      code?: unknown;
      retryable?: unknown;
    };
    metadata?: {
      model?: unknown;
      promptVersion?: unknown;
      usage?: {
        inputTokens?: unknown;
        outputTokens?: unknown;
        totalTokens?: unknown;
      };
    };
  };

  if (result.ok !== true) {
    return {
      ok: false,
      message:
        typeof result.message === "string" ? result.message : "AI抽出に失敗しました",
      ...(typeof result.error?.code === "string" &&
      typeof result.error.retryable === "boolean"
        ? {
            error: {
              code: result.error.code,
              retryable: result.error.retryable
            }
          }
        : {})
    };
  }

  const parsed = emailMonitorExtractionSchema.safeParse(result.data);
  const usage = result.metadata?.usage;
  if (
    !parsed.success ||
    typeof result.metadata?.model !== "string" ||
    typeof result.metadata.promptVersion !== "string" ||
    typeof usage?.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number" ||
    typeof usage.totalTokens !== "number"
  ) {
    return { ok: false, message: "AI抽出結果の形式が不正です" };
  }

  return {
    ok: true,
    data: parsed.data,
    metadata: {
      model: result.metadata.model,
      promptVersion: result.metadata.promptVersion,
      usage: {
        inputTokens: Math.max(0, Math.trunc(usage.inputTokens)),
        outputTokens: Math.max(0, Math.trunc(usage.outputTokens)),
        totalTokens: Math.max(0, Math.trunc(usage.totalTokens))
      }
    }
  };
}
