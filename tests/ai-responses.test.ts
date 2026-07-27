import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_AI_MODEL,
  MAX_AI_OUTPUT_TOKENS,
  estimateStructuredAiTokenCeiling,
  requestStructuredAi
} from "@/lib/ai/responses";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("requestStructuredAi", () => {
  it("estimates a conservative total-token ceiling from the complete request", () => {
    const request = {
      schemaName: "test_schema",
      jsonSchema: {
        type: "object",
        properties: { value: { type: "string" } }
      },
      systemPrompt: "system",
      userPrompt: "日本語".repeat(2_000)
    };
    const ceiling = estimateStructuredAiTokenCeiling(request);

    expect(ceiling).toBeGreaterThan(
      new TextEncoder().encode(JSON.stringify(request)).byteLength +
        MAX_AI_OUTPUT_TOKENS
    );
  });

  it("calls only Groq Responses with the free-model defaults and returns usage", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ value: "ok" }),
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            total_tokens: 150
          }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestStructuredAi({
      schemaName: "test_schema",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } }
      },
      outputSchema: z.object({ value: z.string() }),
      systemPrompt: "system",
      userPrompt: "user"
    });

    expect(result).toEqual({
      ok: true,
      data: { value: "ok" },
      metadata: {
        provider: "groq",
        model: DEFAULT_AI_MODEL,
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150
        }
      }
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(init.body));
    expect(url).toBe("https://api.groq.com/openai/v1/responses");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-groq-key"
    });
    expect(requestBody).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning: { effort: "high" },
      max_output_tokens: MAX_AI_OUTPUT_TOKENS,
      text: {
        format: {
          type: "json_schema",
          name: "test_schema",
          strict: true
        }
      }
    });
  });

  it("does not fall back to a paid OpenAI key", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "paid-key-must-not-be-used");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestStructuredAi({
      schemaName: "test_schema",
      jsonSchema: { type: "object" },
      outputSchema: z.object({}),
      systemPrompt: "system",
      userPrompt: "user"
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        provider: "groq",
        code: "INVALID_CONFIGURATION",
        retryable: false
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a typed retryable error for the Groq free-tier limit", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
    );

    const result = await requestStructuredAi({
      schemaName: "test_schema",
      jsonSchema: { type: "object" },
      outputSchema: z.object({}),
      systemPrompt: "system",
      userPrompt: "user"
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        provider: "groq",
        code: "RATE_LIMITED",
        retryable: true,
        status: 429
      }
    });
  });

  it("rejects a nominally successful response without token usage", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ output_text: "{}" }), { status: 200 })
      )
    );

    const result = await requestStructuredAi({
      schemaName: "test_schema",
      jsonSchema: { type: "object" },
      outputSchema: z.object({}),
      systemPrompt: "system",
      userPrompt: "user"
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_RESPONSE",
        retryable: false
      }
    });
  });
});
