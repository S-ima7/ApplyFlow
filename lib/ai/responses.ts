import type { z } from "zod";

export const AI_PROVIDER = "cloudflare-workers-ai" as const;
export const DEFAULT_AI_MODEL = "@cf/openai/gpt-oss-120b";
export const DEFAULT_AI_REASONING_EFFORT = "high";
export const MAX_AI_OUTPUT_TOKENS = 8_192;
export const CLOUDFLARE_INPUT_NEURONS_PER_MILLION_TOKENS = 31_818;
export const CLOUDFLARE_OUTPUT_NEURONS_PER_MILLION_TOKENS = 68_182;
const CLOUDFLARE_SERVER_FRAMING_TOKEN_ALLOWANCE = 2_048;

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
  | "OUTPUT_TRUNCATED"
  | "INVALID_JSON"
  | "SCHEMA_VALIDATION_FAILED";

export type AiClientError = {
  provider: typeof AI_PROVIDER | "local";
  code: AiErrorCode;
  retryable: boolean;
  status?: number;
};

export type StructuredAiResult<T> =
  | {
      ok: true;
      data: T;
      metadata: {
        provider: typeof AI_PROVIDER;
        model: string;
        usage: AiUsage;
      };
    }
  | {
      ok: false;
      message: string;
      error: AiClientError;
    };

export type CloudflareResponsePayload = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
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
  recoverOutput?: (value: unknown) => T | undefined;
};

export async function requestStructuredAi<T>(
  request: StructuredAiRequest<T>
): Promise<StructuredAiResult<T>> {
  const provider = process.env.AI_PROVIDER || AI_PROVIDER;

  if (provider !== AI_PROVIDER) {
    return failure(
      "INVALID_CONFIGURATION",
      `AI_PROVIDER は ${AI_PROVIDER} のみ使用できます`,
      false
    );
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId) {
    return failure(
      "INVALID_CONFIGURATION",
      "CLOUDFLARE_ACCOUNT_ID が設定されていません",
      false
    );
  }
  if (!apiToken) {
    return failure(
      "MISSING_API_KEY",
      "CLOUDFLARE_API_TOKEN が設定されていません",
      false
    );
  }

  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
  if (model !== DEFAULT_AI_MODEL) {
    return failure(
      "INVALID_CONFIGURATION",
      `AI_MODEL は ${DEFAULT_AI_MODEL} のみ使用できます`,
      false
    );
  }
  const reasoningEffort =
    process.env.AI_REASONING_EFFORT || DEFAULT_AI_REASONING_EFFORT;
  if (reasoningEffort !== DEFAULT_AI_REASONING_EFFORT) {
    return failure(
      "INVALID_CONFIGURATION",
      `AI_REASONING_EFFORT は ${DEFAULT_AI_REASONING_EFFORT} のみ使用できます`,
      false
    );
  }
  const requestBody = buildCloudflareRequestBody(
    request,
    model,
    reasoningEffort
  );

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(request.timeoutMs ?? 45_000),
        body: JSON.stringify(requestBody)
      }
    );
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

  let payload: CloudflareResponsePayload;
  try {
    payload = (await response.json()) as CloudflareResponsePayload;
  } catch {
    return failure(
      "INVALID_RESPONSE",
      "AI抽出結果を読み取れませんでした",
      false,
      response.status
    );
  }

  if (payload.status === "incomplete") {
    return failure(
      "OUTPUT_TRUNCATED",
      "AI抽出結果が途中で終了しました。もう一度抽出してください",
      true,
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

  const json = parseAiJson(text);
  if (!json.ok) {
    return failure(
      "INVALID_JSON",
      "AI抽出結果が途中で終了した可能性があります。もう一度抽出してください",
      true,
      response.status
    );
  }

  let parsed = request.outputSchema.safeParse(json.value);
  if (!parsed.success && request.recoverOutput) {
    const recovered = request.recoverOutput(json.value);
    if (recovered !== undefined) {
      parsed = request.outputSchema.safeParse(recovered);
    }
  }
  if (!parsed.success) {
    return failure(
      "SCHEMA_VALIDATION_FAILED",
      "AI抽出結果の形式が不正です。もう一度抽出してください",
      true,
      response.status
    );
  }

  return {
    ok: true,
    data: parsed.data,
    metadata: {
      provider: AI_PROVIDER,
      model,
      usage
    }
  };
}

export function parseAiJson(text: string):
  | { ok: true; value: unknown }
  | { ok: false } {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const embedded =
    firstBrace >= 0 && lastBrace > firstBrace
      ? trimmed.slice(firstBrace, lastBrace + 1)
      : undefined;

  for (const candidate of [trimmed, fenced, embedded]) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      continue;
    }
  }

  return { ok: false };
}

export function estimateStructuredAiUsageCeiling(
  request: Pick<
    StructuredAiRequest<unknown>,
    "schemaName" | "jsonSchema" | "systemPrompt" | "userPrompt"
  >
) {
  const requestBody = buildCloudflareRequestBody(
    request,
    DEFAULT_AI_MODEL,
    DEFAULT_AI_REASONING_EFFORT
  );
  const inputByteCeiling = new TextEncoder().encode(
    JSON.stringify(requestBody)
  ).byteLength;

  // A provider tokenizer is intentionally not added: the complete request byte
  // count plus framing is a dependency-free upper bound for UTF-8 token counts.
  return {
    inputTokens:
      inputByteCeiling + CLOUDFLARE_SERVER_FRAMING_TOKEN_ALLOWANCE,
    outputTokens: MAX_AI_OUTPUT_TOKENS
  };
}

export function calculateCloudflareNeurons(
  usage: Pick<AiUsage, "inputTokens" | "outputTokens">
) {
  if (!isTokenCount(usage.inputTokens) || !isTokenCount(usage.outputTokens)) {
    return null;
  }

  return Math.ceil(
    (usage.inputTokens * CLOUDFLARE_INPUT_NEURONS_PER_MILLION_TOKENS +
      usage.outputTokens * CLOUDFLARE_OUTPUT_NEURONS_PER_MILLION_TOKENS) /
      1_000_000
  );
}

function buildCloudflareRequestBody(
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

export function extractTextFromAiResponse(data: CloudflareResponsePayload) {
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

function parseUsage(
  usage: CloudflareResponsePayload["usage"]
): AiUsage | null {
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
      "Cloudflare Workers AIの認証に失敗しました",
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
      provider: AI_PROVIDER,
      code,
      retryable,
      ...(status === undefined ? {} : { status })
    }
  };
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
