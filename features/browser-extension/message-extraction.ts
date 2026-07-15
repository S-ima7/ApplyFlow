import {
  EMAIL_EXTRACTION_JSON_SCHEMA,
  extractTextFromOpenAIResponse
} from "@/features/email-import/extraction";
import { emailExtractionSchema } from "@/features/email-import/schema";
import {
  browserMessageEventTypes,
  type BrowserMessageExtractionRequestInput
} from "@/features/browser-extension/contracts";
import { z } from "zod";

export const BROWSER_MESSAGE_EXTRACTION_PROMPT_VERSION = "2026-07-15.v1";

export const browserMessageExtractionSchema = emailExtractionSchema.extend({
  eventType: z.enum(browserMessageEventTypes)
});

export type BrowserMessageExtraction = z.infer<typeof browserMessageExtractionSchema>;

type BrowserMessageExtractionResult =
  | {
      ok: true;
      data: BrowserMessageExtraction;
      metadata: { model: string; promptVersion: string };
    }
  | { ok: false; message: string };

export const BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA = {
  ...EMAIL_EXTRACTION_JSON_SCHEMA,
  required: ["eventType", ...EMAIL_EXTRACTION_JSON_SCHEMA.required],
  properties: {
    eventType: {
      type: "string",
      enum: browserMessageEventTypes,
      description:
        "CREATE_OR_UPDATE for a new/confirmed/proposed schedule, RESCHEDULE for a change, CANCEL for cancellation"
    },
    ...EMAIL_EXTRACTION_JSON_SCHEMA.properties
  }
} as const;

export async function extractBrowserMessageWithOpenAI(
  input: BrowserMessageExtractionRequestInput,
  timezone = "Asia/Tokyo",
  referenceNow = new Date()
): Promise<BrowserMessageExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { ok: false, message: "OPENAI_API_KEY が設定されていません" };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: buildBrowserMessageSystemPrompt() },
          {
            role: "user",
            content: buildBrowserMessagePrompt(input, timezone, referenceNow)
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "applyflow_browser_message_extraction",
            strict: true,
            schema: BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA
          }
        }
      })
    });
  } catch {
    return {
      ok: false,
      message: "AI抽出がタイムアウトしました。時間をおいて再実行してください"
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message:
        response.status === 429
          ? "AI抽出の利用上限に達しました。時間をおいて再実行してください"
          : "AI抽出に失敗しました"
    };
  }

  const text = extractTextFromOpenAIResponse((await response.json()) as Parameters<
    typeof extractTextFromOpenAIResponse
  >[0]);

  if (!text) return { ok: false, message: "AI抽出結果を読み取れませんでした" };

  try {
    const parsed = browserMessageExtractionSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, message: "AI抽出結果の形式が不正です" };

    return {
      ok: true,
      data: parsed.data,
      metadata: { model, promptVersion: BROWSER_MESSAGE_EXTRACTION_PROMPT_VERSION }
    };
  } catch {
    return { ok: false, message: "AI抽出結果のJSON解析に失敗しました" };
  }
}

export function buildBrowserMessagePrompt(
  input: BrowserMessageExtractionRequestInput,
  timezone: string,
  referenceNow: Date
) {
  return [
    `User timezone: ${timezone}`,
    `Current reference datetime: ${referenceNow.toISOString()}`,
    `Message captured datetime: ${input.capturedAt}`,
    `Source site: ${input.sourceSite}`,
    `Page title: ${input.pageTitle ?? ""}`,
    "",
    "User-selected company message:",
    input.selectedText
  ].join("\n");
}

function buildBrowserMessageSystemPrompt() {
  return [
    "Extract recruiting interview scheduling information from the user-selected Japanese or English company message.",
    "Return only fields matching the JSON schema and use null when unsupported.",
    "Classify an explicit cancellation as CANCEL and an explicit date/time change as RESCHEDULE; otherwise use CREATE_OR_UPDATE.",
    "For CANCEL, return no confirmed or proposed slots. For RESCHEDULE, return only the new schedule.",
    "Distinguish proposed candidate times from one confirmed time and never duplicate the confirmed time in proposedSlots.",
    "If a start time is present but the end time is omitted, set the end time to 60 minutes after the start; the user will review it.",
    "Resolve relative dates from the captured datetime, using the user timezone when none is written.",
    "Normalize every datetime to ISO 8601 with an explicit numeric offset.",
    "Ignore navigation, signatures, footers, and unrelated text.",
    "For each field provide calibrated confidence and a short supporting excerpt."
  ].join(" ");
}
