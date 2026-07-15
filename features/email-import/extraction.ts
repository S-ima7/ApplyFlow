import { stageTypeValues } from "@/features/applications/schema";
import { prepareEmailBodyForExtraction } from "@/features/email-import/preprocessing";
import {
  emailExtractionFieldKeys,
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

export const EMAIL_EXTRACTION_PROMPT_VERSION = "2026-07-14.v2";

export type EmailExtractionResult =
  | {
      ok: true;
      data: EmailExtraction;
      metadata: {
        model: string;
        promptVersion: string;
      };
    }
  | {
      ok: false;
      message: string;
    };

const confidenceProperties = Object.fromEntries(
  emailExtractionFieldKeys.map((key) => [
    key,
    {
      type: "number",
      minimum: 0,
      maximum: 1
    }
  ])
);

const evidenceProperties = Object.fromEntries(
  emailExtractionFieldKeys.map((key) => [
    key,
    nullableStringSchema(
      "A short excerpt supporting the extracted value, or null when the value is unknown"
    )
  ])
);

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
    "confidence",
    "fieldConfidence",
    "evidence"
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
          timezone: nullableStringSchema("IANA timezone if present, otherwise the user timezone")
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
        timezone: nullableStringSchema("IANA timezone if present, otherwise the user timezone")
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
    },
    fieldConfidence: {
      type: "object",
      additionalProperties: false,
      required: [...emailExtractionFieldKeys],
      properties: confidenceProperties
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: [...emailExtractionFieldKeys],
      properties: evidenceProperties
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
    data: parsed.data,
    metadata: {
      model: "stored-result",
      promptVersion: "legacy"
    }
  };
}

export async function extractEmailWithOpenAI(
  email: GmailFullMessage,
  timezone = "Asia/Tokyo",
  referenceNow = new Date()
): Promise<EmailExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      message: "OPENAI_API_KEY が設定されていません"
    };
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
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: buildSystemPrompt()
          },
          {
            role: "user",
            content: buildExtractionPrompt(email, timezone, referenceNow)
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

  const data = (await response.json()) as OpenAIResponsesPayload;
  const text = extractTextFromOpenAIResponse(data);

  if (!text) {
    return {
      ok: false,
      message: "AI抽出結果を読み取れませんでした"
    };
  }

  try {
    const normalized = normalizeEmailExtraction(JSON.parse(text));

    if (!normalized.ok) {
      return normalized;
    }

    return {
      ok: true,
      data: normalized.data,
      metadata: {
        model,
        promptVersion: EMAIL_EXTRACTION_PROMPT_VERSION
      }
    };
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

export function buildExtractionPrompt(
  email: GmailFullMessage,
  timezone: string,
  referenceNow: Date
) {
  const receivedAt = email.sentAt?.toISOString() ?? "unknown";
  const body = prepareEmailBodyForExtraction(email.bodyText);

  return [
    `User timezone: ${timezone}`,
    `Current reference datetime: ${referenceNow.toISOString()}`,
    `Email sent/received datetime: ${receivedAt}`,
    `Subject: ${email.subject ?? ""}`,
    `From: ${email.fromAddress ?? ""}`,
    `Snippet: ${email.snippet ?? ""}`,
    "",
    "Latest message (authoritative for changes and cancellations):",
    body.latestMessage || "(empty)",
    "",
    "Quoted or forwarded context (use only to fill omitted context):",
    body.quotedContext || "(none)"
  ].join("\n");
}

function buildSystemPrompt() {
  return [
    "Extract recruiting/application process information from Japanese or English email.",
    "Return only fields matching the JSON schema and use null when the source does not support a value.",
    "Treat the latest message as authoritative: a cancellation, reschedule, or confirmed time overrides older quoted content.",
    "Do not treat a sender signature, email footer, or unrelated calendar text as a company, position, deadline, or candidate slot.",
    "Distinguish proposed candidate times from a single confirmed time. Do not copy the confirmed time into proposedSlots.",
    "Resolve relative dates from the email sent datetime first, then the current reference datetime. Use the user timezone when no timezone is written.",
    "Normalize every datetime to ISO 8601 with an explicit numeric offset.",
    "For each field, provide calibrated confidence and a short supporting excerpt. Use null evidence and low confidence when unknown."
  ].join(" ");
}

function nullableStringSchema(description?: string) {
  return {
    type: ["string", "null"],
    ...(description ? { description } : {})
  } as const;
}
