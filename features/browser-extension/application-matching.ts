export type BrowserMessageApplicationMatchInput = {
  id: string;
  companyId: string;
  companyName: string;
  position: string;
  sourceSite: string | null;
};

export type BrowserMessageApplicationMatch = BrowserMessageApplicationMatchInput & {
  matchKind: "EXACT" | "POSSIBLE" | "NONE";
  matchScore: number;
};

export type BrowserMessageCompanySuggestion = {
  id: string;
  name: string;
  matchKind: "EXACT" | "POSSIBLE";
};

export type BrowserMessageMatchResolution = {
  applications: BrowserMessageApplicationMatch[];
  recommendedApplicationId: string | null;
  possibleApplicationIds: string[];
  exactCompanyId: string | null;
  companySuggestions: BrowserMessageCompanySuggestion[];
  resolution:
    | "EXACT_APPLICATION"
    | "CONFIRM_APPLICATION"
    | "CREATE_WITH_EXISTING_COMPANY"
    | "CONFIRM_COMPANY"
    | "CREATE_NEW";
};

export function resolveBrowserMessageApplicationMatch(
  applications: BrowserMessageApplicationMatchInput[],
  extraction: { companyName: string | null; position: string | null },
  sourceSite: string
): BrowserMessageMatchResolution {
  const extractedCompany = extraction.companyName ?? "";
  const exactCompanyApplications = applications.filter((application) =>
    isExactCompanyName(application.companyName, extractedCompany)
  );
  const possibleCompanyApplications = applications.filter((application) =>
    isPossibleCompanyVariant(application.companyName, extractedCompany)
  );
  const extractedPosition = extraction.position?.trim() ?? "";
  const exactPositionApplications = exactCompanyApplications.filter((application) =>
    extractedPosition ? isExactMatchText(application.position, extractedPosition) : false
  );

  let recommendedApplicationId: string | null = null;
  if (exactPositionApplications.length === 1) {
    recommendedApplicationId = exactPositionApplications[0].id;
  } else if (!extractedPosition && exactCompanyApplications.length === 1) {
    recommendedApplicationId = exactCompanyApplications[0].id;
  }

  const possibleApplicationIds = applications
    .filter((application) => {
      if (application.id === recommendedApplicationId) return false;
      if (
        exactPositionApplications.length > 1 &&
        exactPositionApplications.some((candidate) => candidate.id === application.id)
      ) {
        return true;
      }
      const exactCompany = exactCompanyApplications.some((item) => item.id === application.id);
      const possibleCompany = possibleCompanyApplications.some((item) => item.id === application.id);
      if (!extractedPosition) return exactCompany || possibleCompany;
      return (
        (exactCompany && isPossibleTextVariant(application.position, extractedPosition)) ||
        (possibleCompany &&
          (isExactMatchText(application.position, extractedPosition) ||
            isPossibleTextVariant(application.position, extractedPosition)))
      );
    })
    .map((application) => application.id);

  const exactCompany = exactCompanyApplications[0];
  const companySuggestions = uniqueCompanies([
    ...exactCompanyApplications.map((application) => ({
      id: application.companyId,
      name: application.companyName,
      matchKind: "EXACT" as const
    })),
    ...possibleCompanyApplications.map((application) => ({
      id: application.companyId,
      name: application.companyName,
      matchKind: "POSSIBLE" as const
    }))
  ]);

  const rankedApplications = applications
    .map((application) => {
      const matchKind =
        application.id === recommendedApplicationId
          ? "EXACT"
          : possibleApplicationIds.includes(application.id)
            ? "POSSIBLE"
            : "NONE";
      return {
        ...application,
        matchKind,
        matchScore:
          (matchKind === "EXACT" ? 200 : matchKind === "POSSIBLE" ? 100 : 0) +
          (application.sourceSite === sourceSite ? 10 : 0)
      } satisfies BrowserMessageApplicationMatch;
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  const resolution = recommendedApplicationId
    ? "EXACT_APPLICATION"
    : possibleApplicationIds.length > 0
      ? "CONFIRM_APPLICATION"
      : exactCompany
        ? "CREATE_WITH_EXISTING_COMPANY"
        : companySuggestions.some((company) => company.matchKind === "POSSIBLE")
          ? "CONFIRM_COMPANY"
          : "CREATE_NEW";

  return {
    applications: rankedApplications,
    recommendedApplicationId,
    possibleApplicationIds,
    exactCompanyId: exactCompany?.companyId ?? null,
    companySuggestions,
    resolution
  };
}

export function isExactCompanyName(first: string, second: string) {
  const left = normalizeText(first);
  const right = normalizeText(second);
  return Boolean(left && right && left === right);
}

export function isPossibleCompanyVariant(first: string, second: string) {
  if (isExactCompanyName(first, second)) return false;
  const left = normalizeCompanyCore(first);
  const right = normalizeCompanyCore(second);
  return Boolean(left && right && left === right);
}

export function isExactMatchText(first: string, second: string) {
  const left = normalizeText(first);
  const right = normalizeText(second);
  return Boolean(left && right && left === right);
}

function isPossibleTextVariant(first: string, second: string) {
  if (isExactMatchText(first, second)) return false;
  const left = normalizeText(first);
  const right = normalizeText(second);
  return Boolean(
    left.length >= 3 &&
      right.length >= 3 &&
      (left.includes(right) || right.includes(left))
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function normalizeCompanyCore(value: string) {
  return normalizeText(value).replace(
    /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|incorporated|corporation|companylimited|coltd|corp|inc|ltd/g,
    ""
  );
}

function uniqueCompanies(companies: BrowserMessageCompanySuggestion[]) {
  return companies.filter(
    (company, index) => companies.findIndex((candidate) => candidate.id === company.id) === index
  );
}
