type ApplyFlowSourceSite = "GREEN" | "DODA" | "RECRUIT_AGENT";
type ApplyFlowConfidence = "high" | "medium" | "low" | "missing";
type ApplyFlowFieldSource = "json_ld" | "visible_dom" | "meta" | "url";

type ApplyFlowExtractedField = {
  value?: string;
  confidence: ApplyFlowConfidence;
  source: ApplyFlowFieldSource;
};

type ApplyFlowExtractionResult = {
  sourceSite: ApplyFlowSourceSite;
  sourceUrl: string;
  sourceJobId?: string;
  companyName: ApplyFlowExtractedField;
  position: ApplyFlowExtractedField;
  locationText: ApplyFlowExtractedField;
  employmentTypeText: ApplyFlowExtractedField;
  compensationText: ApplyFlowExtractedField;
  capturedAt: string;
  adapterVersion: string;
  warnings: string[];
};

type ApplyFlowMessageEventType = "CREATE_OR_UPDATE" | "RESCHEDULE" | "CANCEL";

type ApplyFlowMessageSlot = {
  startAt: string;
  endAt: string;
  timezone: string | null;
};

type ApplyFlowMessageExtraction = {
  eventType: ApplyFlowMessageEventType;
  companyName: string | null;
  position: string | null;
  stageType: string | null;
  stageName: string | null;
  proposedSlots: ApplyFlowMessageSlot[];
  confirmedSlot: {
    startAt: string | null;
    endAt: string | null;
    timezone: string | null;
  };
  meetingUrl: string | null;
  interviewerName: string | null;
  confidence: number;
};

type ApplyFlowMessageInterviewCandidate = {
  id: string;
  stageType: string;
  stageName: string | null;
  title: string | null;
  status: string;
  confirmedStartAt: string | null;
  confirmedEndAt: string | null;
};

type ApplyFlowMessageApplicationCandidate = {
  id: string;
  companyId: string;
  companyName: string;
  position: string;
  status: string;
  sourceSite: string | null;
  matchScore: number;
  matchKind: "EXACT" | "POSSIBLE" | "NONE";
  interviews: ApplyFlowMessageInterviewCandidate[];
};

type ApplyFlowMessageCompanySuggestion = {
  id: string;
  name: string;
  matchKind: "EXACT" | "POSSIBLE";
};

type ApplyFlowMessageExtractionResponse = {
  ok: true;
  messageDigest: string;
  extraction: ApplyFlowMessageExtraction;
  recommendedApplicationId: string | null;
  recommendedInterviewId: string | null;
  possibleApplicationIds: string[];
  exactCompanyId: string | null;
  companySuggestions: ApplyFlowMessageCompanySuggestion[];
  matchResolution:
    | "EXACT_APPLICATION"
    | "CONFIRM_APPLICATION"
    | "CREATE_WITH_EXISTING_COMPANY"
    | "CONFIRM_COMPANY"
    | "CREATE_NEW";
  applications: ApplyFlowMessageApplicationCandidate[];
};

type ApplyFlowExtensionSettings = {
  apiBaseUrl: string;
  apiToken: string;
  defaultApplicationType:
    | "JOB_HUNTING"
    | "CAREER_CHANGE"
    | "INTERNSHIP"
    | "FREELANCE"
    | "PART_TIME"
    | "GRADUATE_SCHOOL"
    | "OTHER";
  adapters: Record<ApplyFlowSourceSite, boolean>;
};

type ApplyFlowExtractionApi = {
  detectPage(document: Document, url: URL): ApplyFlowSourceSite | null;
  extract(document: Document, url: URL): ApplyFlowExtractionResult | null;
  normalizeUrl(url: URL): string;
};

type ApplyFlowChromeMessageSender = {
  origin?: string;
  url?: string;
  tab?: {
    id?: number;
    url?: string;
  };
};

type ApplyFlowRegisteredContentScript = {
  id: string;
  js: string[];
  matches: string[];
  runAt?: "document_idle";
  persistAcrossSessions?: boolean;
  world?: "ISOLATED";
};

type ApplyFlowChromeTab = {
  id?: number;
  url?: string;
};

declare const chrome: {
  runtime: {
    onInstalled: {
      addListener(callback: () => void): void;
    };
    onStartup: {
      addListener(callback: () => void): void;
    };
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: ApplyFlowChromeMessageSender,
          sendResponse: (response: unknown) => void
        ) => boolean | void
      ): void;
    };
    sendMessage(message: unknown): Promise<unknown>;
    openOptionsPage(): Promise<void>;
  };
  storage: {
    local: {
      get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
    };
    onChanged: {
      addListener(callback: (changes: Record<string, unknown>, areaName: string) => void): void;
    };
  };
  permissions: {
    contains(permissions: { origins?: string[] }): Promise<boolean>;
    request(permissions: { origins?: string[] }): Promise<boolean>;
    remove(permissions: { origins?: string[] }): Promise<boolean>;
  };
  scripting: {
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<ApplyFlowRegisteredContentScript[]>;
    registerContentScripts(scripts: ApplyFlowRegisteredContentScript[]): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
    executeScript(options: {
      target: { tabId: number };
      files: string[];
      world?: "ISOLATED";
    }): Promise<unknown[]>;
  };
  tabs: {
    create(options: { url: string }): Promise<unknown>;
    query(options: { active: boolean; currentWindow: boolean }): Promise<ApplyFlowChromeTab[]>;
  };
};
