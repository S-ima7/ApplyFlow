(function initializeApplyFlowServiceWorker() {
  const settingsKey = "settings";
  const scriptIds: Record<ApplyFlowSourceSite, string> = {
    GREEN: "applyflow-green",
    DODA: "applyflow-doda"
  };
  const sitePatterns: Record<ApplyFlowSourceSite, string> = {
    GREEN: "https://*.green-japan.com/*",
    DODA: "https://*.doda.jp/*"
  };
  const defaultSettings: ApplyFlowExtensionSettings = {
    apiBaseUrl: "",
    apiToken: "",
    defaultApplicationType: "CAREER_CHANGE",
    adapters: {
      GREEN: false,
      DODA: false
    }
  };
  let registrationSync = Promise.resolve();

  chrome.runtime.onInstalled.addListener(() => {
    void initializeStorage().then(queueContentScriptSync);
  });
  chrome.runtime.onStartup.addListener(() => {
    void initializeStorage().then(queueContentScriptSync);
  });
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local") void queueContentScriptSync();
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleMessage(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, code: "INTERNAL_ERROR", message: "拡張機能でエラーが発生しました" }));
    return true;
  });

  void initializeStorage().then(queueContentScriptSync);

  async function initializeStorage() {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    const stored = await chrome.storage.local.get(settingsKey);
    if (!isRecord(stored[settingsKey])) {
      await chrome.storage.local.set({ [settingsKey]: defaultSettings });
    }
  }

  async function getSettings(): Promise<ApplyFlowExtensionSettings> {
    const stored = await chrome.storage.local.get(settingsKey);
    const value = stored[settingsKey];
    if (!isRecord(value)) return defaultSettings;
    const adapters = isRecord(value.adapters) ? value.adapters : {};
    const apiBaseUrl = typeof value.apiBaseUrl === "string" ? parseApiBaseUrl(value.apiBaseUrl) : null;
    return {
      apiBaseUrl: apiBaseUrl ?? defaultSettings.apiBaseUrl,
      apiToken: typeof value.apiToken === "string" ? value.apiToken : "",
      defaultApplicationType: isApplicationType(value.defaultApplicationType)
        ? value.defaultApplicationType
        : defaultSettings.defaultApplicationType,
      adapters: {
        GREEN: adapters.GREEN === true,
        DODA: adapters.DODA === true
      }
    };
  }

  async function syncContentScriptRegistrations() {
    const settings = await getSettings();
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: Object.values(scriptIds)
    });
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
    }

    const scripts: ApplyFlowRegisteredContentScript[] = [];
    for (const site of ["GREEN", "DODA"] as const) {
      if (!settings.adapters[site]) continue;
      const matches = [sitePatterns[site]];
      if (!(await chrome.permissions.contains({ origins: matches }))) continue;
      scripts.push({
        id: scriptIds[site],
        js: ["extraction.js", "content.js"],
        matches,
        runAt: "document_idle",
        persistAcrossSessions: true,
        world: "ISOLATED"
      });
    }

    if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
  }

  function queueContentScriptSync() {
    registrationSync = registrationSync.then(syncContentScriptRegistrations, syncContentScriptRegistrations);
    return registrationSync;
  }

  async function handleMessage(message: unknown, sender: ApplyFlowChromeMessageSender) {
    if (!isRecord(message) || typeof message.type !== "string") {
      return { ok: false, code: "INVALID_MESSAGE", message: "不正なメッセージです" };
    }

    if (message.type === "OPEN_OPTIONS") {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    if (message.type === "SYNC_REGISTRATIONS") {
      await queueContentScriptSync();
      return { ok: true };
    }

    const settings = await getSettings();

    if (message.type === "GET_SETTINGS") {
      return {
        ok: true,
        settings: {
          defaultApplicationType: settings.defaultApplicationType,
          configured: Boolean(settings.apiToken && settings.apiBaseUrl)
        }
      };
    }

    if (message.type === "OPEN_APPLICATION") {
      if (typeof message.applicationUrl !== "string") {
        return { ok: false, code: "INVALID_URL", message: "URLが不正です" };
      }
      const apiOrigin = parseApiBaseUrl(settings.apiBaseUrl);
      if (!apiOrigin) {
        return { ok: false, code: "INVALID_API_URL", message: "ApplyFlow URLにはHTTPS URLを設定してください" };
      }
      const target = new URL(message.applicationUrl);
      if (target.origin !== apiOrigin || !target.pathname.startsWith("/applications/")) {
        return { ok: false, code: "INVALID_URL", message: "URLが許可されていません" };
      }
      await chrome.tabs.create({ url: target.toString() });
      return { ok: true };
    }

    if (message.type === "LOOKUP_CAPTURE" || message.type === "SAVE_CAPTURE") {
      if (!isRecord(message.payload) || !isTrustedCaptureSender(sender, message.payload)) {
        return { ok: false, code: "UNTRUSTED_SENDER", message: "許可されていないページです" };
      }
      if (!settings.apiToken) {
        return { ok: false, code: "AUTH_REQUIRED", message: "拡張機能トークンを設定してください" };
      }

      if (message.type === "LOOKUP_CAPTURE") {
        return callApi(settings, "/api/browser-extension/lookup", message.payload);
      }

      if (typeof message.idempotencyKey !== "string") {
        return { ok: false, code: "INVALID_MESSAGE", message: "保存要求の識別子がありません" };
      }
      return callApi(
        settings,
        "/api/browser-extension/captures",
        message.payload,
        message.idempotencyKey
      );
    }

    if (message.type === "EXTRACT_MESSAGE" || message.type === "REGISTER_MESSAGE_EVENT") {
      if (!isRecord(message.payload) || !isTrustedCaptureSender(sender, message.payload)) {
        return { ok: false, code: "UNTRUSTED_SENDER", message: "許可されていないページです" };
      }
      if (!settings.apiToken) {
        return { ok: false, code: "AUTH_REQUIRED", message: "拡張機能トークンを設定してください" };
      }

      if (message.type === "EXTRACT_MESSAGE") {
        return callApi(settings, "/api/browser-extension/message-extractions", message.payload);
      }

      if (typeof message.idempotencyKey !== "string") {
        return { ok: false, code: "INVALID_MESSAGE", message: "登録要求の識別子がありません" };
      }
      return callApi(
        settings,
        "/api/browser-extension/message-events",
        message.payload,
        message.idempotencyKey
      );
    }

    return { ok: false, code: "UNKNOWN_MESSAGE", message: "未対応の操作です" };
  }

  async function callApi(
    settings: ApplyFlowExtensionSettings,
    path: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    const baseUrl = parseApiBaseUrl(settings.apiBaseUrl);
    if (!baseUrl) {
      return { ok: false, code: "INVALID_API_URL", message: "ApplyFlow URLにはHTTPS URLを設定してください" };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${settings.apiToken}`,
      "Content-Type": "application/json"
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    try {
      const response = await fetch(new URL(path, `${baseUrl}/`), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
      const result = (await response.json()) as unknown;

      if (!isRecord(result)) {
        return { ok: false, code: "INVALID_RESPONSE", message: "ApplyFlowの応答が不正です" };
      }
      return result;
    } catch {
      return { ok: false, code: "NETWORK_ERROR", message: "ApplyFlowへ接続できません" };
    }
  }

  function isTrustedCaptureSender(
    sender: ApplyFlowChromeMessageSender,
    payload: Record<string, unknown>
  ) {
    if ((payload.sourceSite !== "GREEN" && payload.sourceSite !== "DODA") || typeof payload.sourceUrl !== "string") {
      return false;
    }
    const senderUrl = sender.url ?? sender.tab?.url;
    if (!senderUrl) return false;

    try {
      const senderHost = new URL(senderUrl).hostname.toLowerCase();
      const payloadUrl = new URL(payload.sourceUrl);
      const payloadHost = payloadUrl.hostname.toLowerCase();
      return payload.sourceSite === "GREEN"
        ? isHost(senderHost, "green-japan.com") && isHost(payloadHost, "green-japan.com")
        : isHost(senderHost, "doda.jp") && isHost(payloadHost, "doda.jp");
    } catch {
      return false;
    }
  }

  function parseApiBaseUrl(value: string) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  function isHost(hostname: string, expected: string) {
    return hostname === expected || hostname.endsWith(`.${expected}`);
  }

  function isApplicationType(value: unknown): value is ApplyFlowExtensionSettings["defaultApplicationType"] {
    return [
      "JOB_HUNTING",
      "CAREER_CHANGE",
      "INTERNSHIP",
      "FREELANCE",
      "PART_TIME",
      "GRADUATE_SCHOOL",
      "OTHER"
    ].includes(String(value));
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
})();
