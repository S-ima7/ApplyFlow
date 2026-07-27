import type { z } from "zod";

export const DEFAULT_AI_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_AI_REASONING_EFFORT = "high";
export const MAX_AI_OUTPUT_TOKENS = 4_096;
const GROQ_SERVER_FRAMING_TOKEN_ALLOWANCE = 2_048;

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiErrorCode =
  | "INVALID_CONFIGURATION"
  | "MISSING_API_KEY"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_ERROR"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "INVALID_JSON"
  | "SCHEMA_VALIDATION_FAILED";

export type AiClientError = {
  provider: "groq" | "local";
  code: AiErrorCode;
  retryable: boolean;
  status?: number;
};

export type StructuredAiResult<T> =
  | {
      ok: true;
      data: T;
      metadata: {
        provider: "groq";
        model: string;
        usage: AiUsage;
      };
    }
  | {
      ok: false;
      message: string;
      error: AiClientError;
    };

export type GroqResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type StructuredAiRequest<T> = {
  schemaName: string;
  jsonSchema: unknown;
  outputSchema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
};

export async function requestStructuredAi<T>(
  request: StructuredAiRequest<T>
): Promise<StructuredAiResult<T>> {
  const provider = process.env.AI_PROVIDER || "groq";

  if (provider !== "groq") {
    return failure(
      "INVALID_CONFIGURATION",
      "AI_PROVIDER は groq のみ使用できます",
      false
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return failure("MISSING_API_KEY", "GROQ_API_KEY が設定されていません", false);
  }

  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
  const reasoningEffort = normalizeReasoningEffort(
    process.env.AI_REASONING_EFFORT
  );
  const requestBody = buildGroqRequestBody(request, model, reasoningEffort);

  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(request.timeoutMs ?? 45_000),
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      return failure(
        "TIMEOUT",
        "AI抽出がタイムアウトしました。時間をおいて再実行してください",
        true
      );
    }

    return failure(
      "NETWORK_ERROR",
      "AIサービスへ接続できませんでした。時間をおいて再実行してください",
      true
    );
  }

  if (!response.ok) {
    return providerFailure(response.status);
  }

  let payload: GroqResponsePayload;
  try {
    payload = (await response.json()) as GroqResponsePayload;
  } catch {
    return failure(
      "INVALID_RESPONSE",
      "AI抽出結果を読み取れませんでした",
      false,
      response.status
    );
  }

  const text = extractTextFromAiResponse(payload);
  const usage = parseUsage(payload.usage);

  if (!text || !usage) {
    return failure(
      "INVALID_RESPONSE",
      "AI抽出結果を読み取れませんでした",
      false,
      response.status
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failure(
      "INVALID_JSON",
      "AI抽出結果のJSON解析に失敗しました",
      false,
      response.status
    );
  }

  const parsed = request.outputSchema.safeParse(json);
  if (!parsed.success) {
    return failure(
      "SCHEMA_VALIDATION_FAILED",
      "AI抽出結果の形式が不正です",
      false,
      response.status
    );
  }

  return {
    ok: true,
    data: parsed.data,
    metadata: {
      provider: "groq",
      model,
      usage
    }
  };
}

export function estimateStructuredAiTokenCeiling(
  request: Pick<
    StructuredAiRequest<unknown>,
    "schemaName" | "jsonSchema" | "systemPrompt" | "userPrompt"
  >
) {
  const requestBody = buildGroqRequestBody(
    request,
    process.env.AI_MODEL || DEFAULT_AI_MODEL,
    normalizeReasoningEffort(process.env.AI_REASONING_EFFORT)
  );
  const inputByteCeiling = new TextEncoder().encode(
    JSON.stringify(requestBody)
  ).byteLength;

  // Each input token represents at least one byte. Counting the complete JSON
  // request by bytes plus a server-framing allowance is therefore deliberately
  // larger than the provider's input-token count.
  return (
    inputByteCeiling +
    GROQ_SERVER_FRAMING_TOKEN_ALLOWANCE +
    MAX_AI_OUTPUT_TOKENS
  );
}

function buildGroqRequestBody(
  request: Pick<
    StructuredAiRequest<unknown>,
    "schemaName" | "jsonSchema" | "systemPrompt" | "userPrompt"
  >,
  model: string,
  reasoningEffort: "low" | "medium" | "high"
) {
  return {
    model,
    reasoning: {
      effort: reasoningEffort
    },
    max_output_tokens: MAX_AI_OUTPUT_TOKENS,
    input: [
      {
        role: "system",
        content: request.systemPrompt
      },
      {
        role: "user",
        content: request.userPrompt
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: request.schemaName,
        strict: true,
        schema: request.jsonSchema
      }
    }
  };
}

export function extractTextFromAiResponse(data: GroqResponsePayload) {
  if (data.output_text) {
    return data.output_text;
  }

  return data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" || !content.type)
    .map((content) => content.text)
    .filter((text): text is string => Boolean(text))
    .join("")
    .trim();
}

function parseUsage(usage: GroqResponsePayload["usage"]): AiUsage | null {
  if (
    !usage ||
    !isTokenCount(usage.input_tokens) ||
    !isTokenCount(usage.output_tokens) ||
    !isTokenCount(usage.total_tokens)
  ) {
    return null;
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens
  };
}

function providerFailure(status: number): StructuredAiResult<never> {
  if (status === 401 || status === 403) {
    return failure(
      "AUTHENTICATION_ERROR",
      "Groqの認証に失敗しました",
      false,
      status
    );
  }

  if (status === 429) {
    return failure(
      "RATE_LIMITED",
      "AI抽出の利用上限に達しました。時間をおいて再実行してください",
      true,
      status
    );
  }

  if (status >= 500) {
    return failure(
      "PROVIDER_UNAVAILABLE",
      "AIサービスが一時的に利用できません",
      true,
      status
    );
  }

  return failure("PROVIDER_ERROR", "AI抽出に失敗しました", false, status);
}

function failure(
  code: AiErrorCode,
  message: string,
  retryable: boolean,
  status?: number
): StructuredAiResult<never> {
  return {
    ok: false,
    message,
    error: {
      provider: "groq",
      code,
      retryable,
      ...(status === undefined ? {} : { status })
    }
  };
}

function normalizeReasoningEffort(value: string | undefined) {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : DEFAULT_AI_REASONING_EFFORT;
}

function isTokenCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}
