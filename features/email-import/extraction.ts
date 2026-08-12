import { stageTypeValues } from "@/features/applications/schema";
import { prepareEmailBodyForExtraction } from "@/features/email-import/preprocessing";
import {
  emailAiExtractionSchema,
  emailExtractionEventTypes,
  emailExtractionFieldKeys,
  emailExtractionSchema,
  recoverEmailAiExtraction,
  type EmailExtraction
} from "@/features/email-import/schema";
import {
  estimateStructuredAiUsageCeiling,
  extractTextFromAiResponse,
  requestStructuredAi,
  type AiClientError,
  type AiUsage,
  type CloudflareResponsePayload
} from "@/lib/ai/responses";
import type { GmailFullMessage } from "@/lib/gmail";

export const EMAIL_EXTRACTION_PROMPT_VERSION = "2026-08-12.v4";

export type EmailExtractionResult =
  | {
      ok: true;
      data: EmailExtraction;
      metadata: {
        provider: "cloudflare-workers-ai" | "stored";
        model: string;
        promptVersion: string;
        usage: AiUsage;
      };
    }
  | {
      ok: false;
      message: string;
      error: AiClientError;
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
    "interviewerName",
    "confidence",
    "fieldConfidence",
    "evidence"
  ],
  properties: {
    relevant: {
      type: "boolean",
      description:
        "True only when the latest message contains actionable recruiting or application-process information"
    },
    eventType: {
      type: "string",
      enum: emailExtractionEventTypes,
      description:
        "CREATE_OR_UPDATE for new details, RESCHEDULE for a schedule change, CANCEL for cancellation, INFORMATION_ONLY when no action is needed"
    },
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
      message: "AI抽出結果の形式が不正です",
      error: {
        provider: "local",
        code: "SCHEMA_VALIDATION_FAILED",
        retryable: false
      }
    };
  }

  return {
    ok: true,
    data: parsed.data,
    metadata: {
      provider: "stored",
      model: "stored-result",
      promptVersion: "legacy",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    }
  };
}

export async function extractEmailWithAi(
  email: GmailFullMessage,
  timezone = "Asia/Tokyo",
  referenceNow = new Date()
): Promise<EmailExtractionResult> {
  const request = buildEmailAiRequest(email, timezone, referenceNow);
  const result = await requestStructuredAi({
    ...request,
    outputSchema: emailAiExtractionSchema,
    recoverOutput: (value) =>
      recoverEmailAiExtraction(value, { timezone })
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      error: result.error
    };
  }

  return {
    ok: true,
    data: result.data,
    metadata: {
      ...result.metadata,
      promptVersion: EMAIL_EXTRACTION_PROMPT_VERSION
    }
  };
}

export function estimateEmailExtractionUsageCeiling(
  email: GmailFullMessage,
  timezone = "Asia/Tokyo",
  referenceNow = new Date()
) {
  return estimateStructuredAiUsageCeiling(
    buildEmailAiRequest(email, timezone, referenceNow)
  );
}

function buildEmailAiRequest(
  email: GmailFullMessage,
  timezone: string,
  referenceNow: Date
) {
  return {
    schemaName: "applyflow_email_extraction",
    jsonSchema: EMAIL_EXTRACTION_JSON_SCHEMA,
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildExtractionPrompt(email, timezone, referenceNow)
  };
}

/**
 * @deprecated Use extractEmailWithAi. This alias never calls the paid OpenAI API.
 */
export const extractEmailWithOpenAI = extractEmailWithAi;

/**
 * @deprecated Use extractTextFromAiResponse from the shared AI client.
 */
export const extractTextFromOpenAIResponse = (
  data: CloudflareResponsePayload
) => extractTextFromAiResponse(data);

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
    "Set relevant to true only when the latest message contains actionable recruiting or application-process information; otherwise set false and INFORMATION_ONLY.",
    "Classify an explicit cancellation as CANCEL and an explicit date/time change as RESCHEDULE; use CREATE_OR_UPDATE for new or confirmed details.",
    "Treat the latest message as authoritative: a cancellation, reschedule, or confirmed time overrides older quoted content.",
    "Do not treat a sender signature, email footer, or unrelated calendar text as a company, position, deadline, or candidate slot.",
    "Distinguish proposed candidate times from a single confirmed time. Do not copy the confirmed time into proposedSlots.",
    "Resolve relative dates from the email sent datetime first, then the current reference datetime. Use the user timezone when no timezone is written.",
    "Normalize every datetime to ISO 8601 with an explicit numeric offset.",
    "Return each data field as its schema scalar, object, or array value. Never wrap a field in {value, confidence, excerpt} and never JSON-stringify a field value; put metadata only in fieldConfidence and evidence.",
    "For every field including relevant and eventType, provide calibrated confidence and a short supporting excerpt. Use null evidence and low confidence when unknown."
  ].join(" ");
}

function nullableStringSchema(description?: string) {
  return {
    type: ["string", "null"],
    ...(description ? { description } : {})
  } as const;
}
