(function initializeOptionsPage() {
  const settingsKey = "settings";
  const sitePatterns: Record<ApplyFlowSourceSite, string> = {
    GREEN: "https://*.green-japan.com/*",
    DODA: "https://*.doda.jp/*"
  };
  const form = document.querySelector<HTMLFormElement>("#settings-form");
  const status = document.querySelector<HTMLElement>("#status");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-settings");

  void loadSettings();
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings();
  });
  resetButton?.addEventListener("click", () => void resetSettings());

  async function loadSettings() {
    const stored = await chrome.storage.local.get(settingsKey);
    const value = isRecord(stored[settingsKey]) ? stored[settingsKey] : {};
    setValue("#api-base-url", typeof value.apiBaseUrl === "string" ? value.apiBaseUrl : "http://localhost:3000");
    setValue("#api-token", typeof value.apiToken === "string" ? value.apiToken : "");
    setValue(
      "#default-application-type",
      typeof value.defaultApplicationType === "string" ? value.defaultApplicationType : "CAREER_CHANGE"
    );
    const adapters = isRecord(value.adapters) ? value.adapters : {};
    setChecked("#adapter-green", adapters.GREEN === true);
    setChecked("#adapter-doda", adapters.DODA === true);
  }

  async function saveSettings() {
    const apiBaseUrl = getValue("#api-base-url");
    const apiToken = getValue("#api-token");
    const defaultApplicationType = getValue("#default-application-type") as ApplyFlowExtensionSettings["defaultApplicationType"];
    const apiPattern = getApiOriginPattern(apiBaseUrl);

    if (!apiPattern) {
      showStatus("ApplyFlow URLはlocalhostのHTTP、またはHTTPSを指定してください。", "error");
      return;
    }
    if (apiToken && !apiToken.startsWith("af_ext_")) {
      showStatus("ApplyFlowの設定画面で発行した拡張機能トークンを入力してください。", "error");
      return;
    }

    const requestedSites = (["GREEN", "DODA"] as const).filter((site) =>
      getChecked(site === "GREEN" ? "#adapter-green" : "#adapter-doda")
    );
    const requestedOrigins = [apiPattern, ...requestedSites.map((site) => sitePatterns[site])];
    const granted = await chrome.permissions.request({ origins: requestedOrigins });

    if (!granted) {
      showStatus("必要なサイト権限が許可されなかったため、設定を保存していません。", "error");
      return;
    }

    const adapters: ApplyFlowExtensionSettings["adapters"] = {
      GREEN: requestedSites.includes("GREEN"),
      DODA: requestedSites.includes("DODA")
    };
    const settings: ApplyFlowExtensionSettings = {
      apiBaseUrl: new URL(apiBaseUrl).origin,
      apiToken,
      defaultApplicationType,
      adapters
    };
    await chrome.storage.local.set({ [settingsKey]: settings });

    for (const site of ["GREEN", "DODA"] as const) {
      if (!adapters[site] && (await chrome.permissions.contains({ origins: [sitePatterns[site]] }))) {
        await chrome.permissions.remove({ origins: [sitePatterns[site]] });
      }
    }

    await chrome.runtime.sendMessage({ type: "SYNC_REGISTRATIONS" });
    showStatus("設定を保存しました。権限を付与した求人ページを再読み込みしてください。", "success");
  }

  async function resetSettings() {
    const apiBaseUrl = getValue("#api-base-url");
    const apiPattern = getApiOriginPattern(apiBaseUrl);
    const origins = [...Object.values(sitePatterns), ...(apiPattern ? [apiPattern] : [])];
    await chrome.permissions.remove({ origins });
    await chrome.storage.local.set({
      [settingsKey]: {
        apiBaseUrl: "http://localhost:3000",
        apiToken: "",
        defaultApplicationType: "CAREER_CHANGE",
        adapters: { GREEN: false, DODA: false }
      }
    });
    await chrome.runtime.sendMessage({ type: "SYNC_REGISTRATIONS" });
    await loadSettings();
    showStatus("ローカル設定と媒体権限を削除しました。ApplyFlow側のトークンも失効してください。", "success");
  }

  function getApiOriginPattern(value: string) {
    try {
      const url = new URL(value);
      const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) return null;
      return `${url.protocol}//${url.hostname}/*`;
    } catch {
      return null;
    }
  }

  function showStatus(message: string, tone: "success" | "error") {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = false;
  }

  function getValue(selector: string) {
    return document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value.trim() ?? "";
  }

  function setValue(selector: string, value: string) {
    const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (input) input.value = value;
  }

  function getChecked(selector: string) {
    return document.querySelector<HTMLInputElement>(selector)?.checked === true;
  }

  function setChecked(selector: string, value: boolean) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input) input.checked = value;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
})();
