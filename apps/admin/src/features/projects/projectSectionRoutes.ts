export const PROJECT_SECTION_IDS = [
  "overview",
  "install",
  "capture",
  "surveys",
  "engineering",
  "notifications",
  "privacy",
] as const;

export type ProjectSectionId = (typeof PROJECT_SECTION_IDS)[number];

export function isProjectSectionId(value: string | null | undefined): value is ProjectSectionId {
  return PROJECT_SECTION_IDS.some((section) => section === value);
}

type ProductSectionLocation = {
  search?: string | URLSearchParams;
  hash?: string;
};

const CANONICAL_SECTION_PATHS: Record<ProjectSectionId, string> = {
  overview: "",
  install: "/settings/installation",
  capture: "/settings/evidence",
  surveys: "/surveys",
  engineering: "/settings/engineering",
  notifications: "/settings/notifications",
  privacy: "/settings/privacy",
};

function nonRoutingSearch(search: ProductSectionLocation["search"]) {
  const params = new URLSearchParams(search);
  params.delete("section");
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function getCanonicalProductSectionLocation(
  projectKey: string,
  section: ProjectSectionId,
  location: ProductSectionLocation = {},
) {
  const projectPath = `/projects/${encodeURIComponent(projectKey)}`;
  return `${projectPath}${CANONICAL_SECTION_PATHS[section]}${nonRoutingSearch(location.search)}${location.hash ?? ""}`;
}

export function getLegacyProductSectionRedirect(
  projectKey: string,
  location: Required<ProductSectionLocation>,
) {
  const params = new URLSearchParams(location.search);
  const requestedSection = params.get("section");
  const section = isProjectSectionId(requestedSection) ? requestedSection : "overview";
  const projectPath = `/projects/${encodeURIComponent(projectKey)}`;
  const search = nonRoutingSearch(params);

  if (section === "overview" && location.hash === "#project-identity-section") {
    return `${projectPath}/settings/general${search}${location.hash}`;
  }
  if (section === "capture" && location.hash === "#project-widget-appearance-section") {
    return `${projectPath}/settings/widget${search}${location.hash}`;
  }
  return getCanonicalProductSectionLocation(projectKey, section, { search: params, hash: location.hash });
}

export function withLegacyProjectSection(search: URLSearchParams, section: ProjectSectionId) {
  const next = new URLSearchParams(search);
  next.set("section", section);
  return next;
}
