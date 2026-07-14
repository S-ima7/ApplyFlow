import { stageTypeValues } from "@/features/applications/schema";
import {
  emailExtractionSchema,
  type EmailExtraction
} from "@/features/email-import/schema";
import type { GmailFullMessage } from "@/lib/gmail";

type OpenAIResponsesPayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type EmailExtractionResult =
  | {
      ok: true;
      data: EmailExtraction;
    }
  | {
      ok: false;
      message: string;
    };

export const EMAIL_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "companyName",
    "position",
    "stageType",
    "stageName",
    "proposedSlots",
    "confirmedSlot",
    "replyDeadline",
    "offerAcceptanceDeadline",
    "meetingUrl",
    "interviewerName",
    "confidence"
  ],
  properties: {
    companyName: nullableStringSchema(),
    position: nullableStringSchema(),
    stageType: {
      type: ["string", "null"],
      enum: [...stageTypeValues, null]
    },
    stageName: nullableStringSchema(),
    proposedSlots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startAt", "endAt", "timezone"],
        properties: {
          startAt: {
            type: "string",
            description: "ISO 8601 datetime with timezone, e.g. 2026-07-12T19:00:00+09:00"
          },
          endAt: {
            type: "string",
            description: "ISO 8601 datetime with timezone"
          },
          timezone: nullableStringSchema("IANA timezone if present, otherwise Asia/Tokyo")
        }
      }
    },
    confirmedSlot: {
      type: "object",
      additionalProperties: false,
      required: ["startAt", "endAt", "timezone"],
      properties: {
        startAt: nullableStringSchema("ISO 8601 datetime with timezone, or null"),
        endAt: nullableStringSchema("ISO 8601 datetime with timezone, or null"),
        timezone: nullableStringSchema("IANA timezone if present, otherwise Asia/Tokyo")
      }
    },
    replyDeadline: nullableStringSchema("ISO 8601 datetime with timezone, or null"),
    offerAcceptanceDeadline: nullableStringSchema(
      "ISO 8601 datetime with timezone, or null"
    ),
    meetingUrl: nullableStringSchema(),
    interviewerName: nullableStringSchema(),
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    }
  }
} as const;

export function normalizeEmailExtraction(value: unknown): EmailExtractionResult {
  const parsed = emailExtractionSchema.safeParse(value);

  if (!parsed.success) {
    return {
      ok: false,
      message: "AI抽出結果の形式が不正です"
    };
  }

  return {
    ok: true,
    data: parsed.data
  };
}

export async function extractEmailWithOpenAI(
  email: GmailFullMessage,
  timezone = "Asia/Tokyo"
): Promise<EmailExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      message: "OPENAI_API_KEY が設定されていません"
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You extract recruiting/application process information from Japanese or English email. Return only fields matching the schema. Use null when unknown. Normalize all datetimes to ISO 8601 with an explicit timezone. Use the user's timezone for ambiguous local times."
        },
        {
          role: "user",
          content: buildExtractionPrompt(email, timezone)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "applyflow_email_extraction",
          strict: true,
          schema: EMAIL_EXTRACTION_JSON_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    return {
      ok: false,
      message: "AI抽出に失敗しました"
    };
  }

  const data = (await response.json()) as OpenAIResponsesPayload;
  const text = extractTextFromOpenAIResponse(data);

  if (!text) {
    return {
      ok: false,
      message: "AI抽出結果を読み取れませんでした"
    };
  }

  try {
    return normalizeEmailExtraction(JSON.parse(text));
  } catch {
    return {
      ok: false,
      message: "AI抽出結果のJSON解析に失敗しました"
    };
  }
}

export function extractTextFromOpenAIResponse(data: OpenAIResponsesPayload) {
  if (data.output_text) {
    return data.output_text;
  }

  return data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((text): text is string => Boolean(text))
    .join("")
    .trim();
}

function buildExtractionPrompt(email: GmailFullMessage, timezone: string) {
  const receivedAt = email.sentAt?.toISOString() ?? "unknown";
  const body = email.bodyText.slice(0, 12000);

  return [
    `User timezone: ${timezone}`,
    `Current reference datetime: ${new Date().toISOString()}`,
    `Email sent/received datetime: ${receivedAt}`,
    `Subject: ${email.subject ?? ""}`,
    `From: ${email.fromAddress ?? ""}`,
    `Snippet: ${email.snippet ?? ""}`,
    "",
    "Email body:",
    body
  ].join("\n");
}

function nullableStringSchema(description?: string) {
  return {
    type: ["string", "null"],
    ...(description ? { description } : {})
  } as const;
}
