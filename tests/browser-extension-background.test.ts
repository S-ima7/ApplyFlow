import { afterEach, describe, expect, it, vi } from "vitest";

describe("browser extension service worker connection boundary", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "chrome");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not send a Bearer request when legacy HTTP settings remain in storage", async () => {
    let handleMessage:
      | ((
          message: unknown,
          sender: ApplyFlowChromeMessageSender,
          sendResponse: (response: unknown) => void
        ) => boolean | void)
      | undefined;
    const fetchApi = vi.fn();
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
          get: vi.fn(async () => ({
            settings: {
              apiBaseUrl: "http://legacy.invalid",
              apiToken: "af_ext_test-token",
              defaultApplicationType: "CAREER_CHANGE",
              adapters: { GREEN: false, DODA: false, RECRUIT_AGENT: false }
            }
          })),
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

    const response = await new Promise<unknown>((resolve) => {
      handleMessage?.(
        {
          type: "EXTRACT_MESSAGE",
          payload: {
            sourceSite: "RECRUIT_AGENT",
            sourceUrl: "https://pdt.r-agent.com/pdt/app/messages"
          }
        },
        { url: "https://pdt.r-agent.com/pdt/app/messages" },
        resolve
      );
    });

    expect(response).toEqual({
      ok: false,
      code: "INVALID_API_URL",
      message: "ApplyFlow URLにはHTTPS URLを設定してください"
    });
    expect(fetchApi).not.toHaveBeenCalled();
  });
});
