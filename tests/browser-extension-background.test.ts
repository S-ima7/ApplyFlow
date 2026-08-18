import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (
  message: unknown,
  sender: ApplyFlowChromeMessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void;

describe("browser extension service worker connection boundary", () => {
  let fetchApi: ReturnType<typeof vi.fn>;
  let handleMessage: MessageListener | undefined;
  let settings: ApplyFlowExtensionSettings;

  beforeEach(async () => {
    handleMessage = undefined;
    settings = {
      apiBaseUrl: "https://applyflow.example.com",
      apiToken: "af_ext_test-token",
      defaultApplicationType: "CAREER_CHANGE",
      adapters: { GREEN: false, DODA: false, RECRUIT_AGENT: false }
    };
    fetchApi = vi.fn(async () => ({ json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchApi);

    const target = globalThis as typeof globalThis & { chrome?: typeof chrome };
    target.chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener) => {
            handleMessage = listener;
          })
        },
        sendMessage: vi.fn(async () => ({ ok: true })),
        openOptionsPage: vi.fn(async () => undefined)
      },
      storage: {
        local: {
          get: vi.fn(async () => ({ settings })),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
          setAccessLevel: vi.fn(async () => undefined)
        },
        onChanged: { addListener: vi.fn() }
      },
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => false),
        remove: vi.fn(async () => false)
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
        executeScript: vi.fn(async () => [])
      },
      tabs: {
        create: vi.fn(async () => undefined),
        query: vi.fn(async () => [])
      }
    };

    // @ts-expect-error Extension service workers intentionally compile as classic scripts, not ES modules.
    await import("../browser-extension/src/background");
    if (!handleMessage) throw new Error("Service Workerのmessage listenerを初期化できませんでした");
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "chrome");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not send a Bearer request when legacy HTTP settings remain in storage", async () => {
    settings.apiBaseUrl = "http://legacy.invalid";

    const response = await sendMessage(
      {
        type: "EXTRACT_MESSAGE",
        payload: {
          sourceSite: "RECRUIT_AGENT",
          sourceUrl: "https://pdt.r-agent.com/pdt/app/messages"
        }
      },
      "https://pdt.r-agent.com/pdt/app/messages"
    );

    expect(response).toEqual({
      ok: false,
      code: "INVALID_API_URL",
      message: "ApplyFlow URLにはHTTPS URLを設定してください"
    });
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each([
    ["LOOKUP_CAPTURE", "www.r-agent.com", "www.r-agent.com", true],
    ["LOOKUP_CAPTURE", "www.r-agent.com", "pdt.r-agent.com", false],
    ["LOOKUP_CAPTURE", "pdt.r-agent.com", "www.r-agent.com", false],
    ["LOOKUP_CAPTURE", "pdt.r-agent.com", "pdt.r-agent.com", false],
    ["SAVE_CAPTURE", "www.r-agent.com", "www.r-agent.com", true],
    ["SAVE_CAPTURE", "www.r-agent.com", "pdt.r-agent.com", false],
    ["SAVE_CAPTURE", "pdt.r-agent.com", "www.r-agent.com", false],
    ["SAVE_CAPTURE", "pdt.r-agent.com", "pdt.r-agent.com", false],
    ["EXTRACT_MESSAGE", "pdt.r-agent.com", "pdt.r-agent.com", true],
    ["REGISTER_MESSAGE_EVENT", "pdt.r-agent.com", "pdt.r-agent.com", true]
  ] as const)(
    "%s validates sender %s and payload %s as allowed=%s",
    async (operation, senderHost, payloadHost, allowed) => {
      const response = await sendMessage(
        {
          type: operation,
          idempotencyKey: "test-idempotency-key",
          payload: {
            sourceSite: "RECRUIT_AGENT",
            sourceUrl: `https://${payloadHost}/test`
          }
        },
        `https://${senderHost}/test`
      );

      if (allowed) {
        expect(response).toEqual({ ok: true });
        expect(fetchApi).toHaveBeenCalledTimes(1);
        return;
      }

      expect(response).toEqual({
        ok: false,
        code: "UNTRUSTED_SENDER",
        message: "許可されていないページです"
      });
      expect(fetchApi).not.toHaveBeenCalled();
    }
  );

  it.each(["EXTRACT_MESSAGE", "REGISTER_MESSAGE_EVENT"] as const)(
    "accepts %s from the current Recruit Agent mypage origin",
    async (operation) => {
      const response = await sendMessage(
        {
          type: operation,
          idempotencyKey: "test-idempotency-key",
          payload: {
            sourceSite: "RECRUIT_AGENT",
            sourceUrl: "https://mypage.r-agent.com/applied/interviews"
          }
        },
        {
          origin: "https://mypage.r-agent.com",
          url: "about:blank",
          tab: { url: "https://mypage.r-agent.com/applied/interviews" }
        }
      );

      expect(response).toEqual({ ok: true });
      expect(fetchApi).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["LOOKUP_CAPTURE", "www.r-agent.com", "www.r-agent.com", true],
    ["LOOKUP_CAPTURE", "mypage.r-agent.com", "www.r-agent.com", false],
    ["LOOKUP_CAPTURE", "www.r-agent.com", "mypage.r-agent.com", false],
    ["SAVE_CAPTURE", "www.r-agent.com", "www.r-agent.com", true],
    ["SAVE_CAPTURE", "mypage.r-agent.com", "www.r-agent.com", false],
    ["SAVE_CAPTURE", "www.r-agent.com", "mypage.r-agent.com", false]
  ] as const)(
    "%s uses sender origin %s with payload %s as allowed=%s",
    async (operation, originHost, payloadHost, allowed) => {
      const response = await sendMessage(
        {
          type: operation,
          idempotencyKey: "test-idempotency-key",
          payload: {
            sourceSite: "RECRUIT_AGENT",
            sourceUrl: `https://${payloadHost}/viewjob/test`
          }
        },
        {
          origin: `https://${originHost}`,
          url: "https://www.r-agent.com/viewjob/test",
          tab: { url: "https://www.r-agent.com/viewjob/test" }
        }
      );

      if (allowed) {
        expect(response).toEqual({ ok: true });
        expect(fetchApi).toHaveBeenCalledTimes(1);
        return;
      }

      expect(response).toEqual({
        ok: false,
        code: "UNTRUSTED_SENDER",
        message: "許可されていないページです"
      });
      expect(fetchApi).not.toHaveBeenCalled();
    }
  );

  function sendMessage(message: unknown, sender: string | ApplyFlowChromeMessageSender) {
    if (!handleMessage) throw new Error("Service Workerのmessage listenerを初期化できませんでした");
    return new Promise<unknown>((resolve) => {
      handleMessage?.(message, typeof sender === "string" ? { url: sender } : sender, resolve);
    });
  }
});
