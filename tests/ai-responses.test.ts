import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_AI_MODEL,
  MAX_AI_OUTPUT_TOKENS,
  calculateCloudflareNeurons,
  estimateStructuredAiUsageCeiling,
  requestStructuredAi
} from "@/lib/ai/responses";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("requestStructuredAi", () => {
  it("estimates conservative input and output ceilings from the complete request", () => {
    const request = {
      schemaName: "test_schema",
      jsonSchema: {
        type: "object",
        properties: { value: { type: "string" } }
      },
      systemPrompt: "system",
      userPrompt: "日本語".repeat(2_000)
    };
    const ceiling = estimateStructuredAiUsageCeiling(request);

    expect(ceiling.inputTokens).toBeGreaterThan(
      new TextEncoder().encode(JSON.stringify(request)).byteLength
    );
    expect(ceiling.outputTokens).toBe(MAX_AI_OUTPUT_TOKENS);
  });

  it("converts input and output tokens to the published gpt-oss neuron units", () => {
    expect(
      calculateCloudflareNeurons({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000
      })
    ).toBe(100_000);
    expect(
      calculateCloudflareNeurons({ inputTokens: 1, outputTokens: 1 })
    ).toBe(1);
  });

  it("calls only Cloudflare Responses with the free-model defaults and returns usage", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
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
        provider: "cloudflare-workers-ai",
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
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/responses"
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-cloudflare-token"
    });
    expect(requestBody).toMatchObject({
      model: "@cf/openai/gpt-oss-120b",
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
        provider: "cloudflare-workers-ai",
        code: "INVALID_CONFIGURATION",
        retryable: false
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unbudgeted Cloudflare model instead of silently changing models", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
    vi.stubEnv("AI_MODEL", "@cf/openai/gpt-oss-20b");
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
      error: { code: "INVALID_CONFIGURATION", retryable: false }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a typed retryable error for the Cloudflare free-tier limit", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
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
        provider: "cloudflare-workers-ai",
        code: "RATE_LIMITED",
        retryable: true,
        status: 429
      }
    });
  });

  it("rejects a nominally successful response without token usage", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-cloudflare-token");
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
