/**
 * Lightweight division labels for UI (no agent prompts).
 * Full roster lives in agency-agents.catalog.json (loaded only in Node seed path).
 */

export type WorkspaceDivisionId =
  | "it"
  | "engineering"
  | "academic"
  | "design"
  | "finance"
  | "game-development"
  | "gis"
  | "healthcare"
  | "marketing"
  | "paid-media"
  | "product"
  | "project-management"
  | "research"
  | "sales"
  | "security"
  | "spatial-computing"
  | "specialized"
  | "support"
  | "testing"
  | "none";

export type WorkspaceDivisionOption = {
  id: WorkspaceDivisionId;
  label: string;
  description: string;
  /** Upstream agency-agents folder; null for aliases / empty. */
  agencyDivision: string | null;
};

/** `it` is an alias for engineering (keeps existing UX). */
export const WORKSPACE_DIVISION_OPTIONS: WorkspaceDivisionOption[] = [
  {
    id: "it",
    label: "IT / Engineering",
    description: "Full engineering roster (alias of Engineering)",
    agencyDivision: "engineering",
  },
  {
    id: "engineering",
    label: "Engineering",
    description: "Frontend, backend, DevOps, architects, …",
    agencyDivision: "engineering",
  },
  {
    id: "product",
    label: "Product",
    description: "Product managers & product specialists",
    agencyDivision: "product",
  },
  {
    id: "project-management",
    label: "Project Management",
    description: "Delivery, coordination, program leads",
    agencyDivision: "project-management",
  },
  {
    id: "testing",
    label: "Testing / QA",
    description: "QA, test automation, quality gates",
    agencyDivision: "testing",
  },
  {
    id: "security",
    label: "Security",
    description: "AppSec, privacy, threat modeling",
    agencyDivision: "security",
  },
  {
    id: "finance",
    label: "Finance",
    description: "Analyst, FP&A, bookkeeper, tax, investment",
    agencyDivision: "finance",
  },
  {
    id: "sales",
    label: "Sales",
    description: "Outbound, deals, proposals, account strategy",
    agencyDivision: "sales",
  },
  {
    id: "marketing",
    label: "Marketing",
    description: "Content, SEO/AEO, growth, brand",
    agencyDivision: "marketing",
  },
  {
    id: "paid-media",
    label: "Paid Media",
    description: "Ads, media buying, performance",
    agencyDivision: "paid-media",
  },
  {
    id: "design",
    label: "Design",
    description: "UX/UI, visual, brand design",
    agencyDivision: "design",
  },
  {
    id: "support",
    label: "Support",
    description: "Customer support & success",
    agencyDivision: "support",
  },
  {
    id: "research",
    label: "Research",
    description: "Research specialists",
    agencyDivision: "research",
  },
  {
    id: "academic",
    label: "Academic",
    description: "Academic & education roles",
    agencyDivision: "academic",
  },
  {
    id: "healthcare",
    label: "Healthcare",
    description: "Healthcare domain specialists",
    agencyDivision: "healthcare",
  },
  {
    id: "gis",
    label: "GIS",
    description: "Geospatial & mapping",
    agencyDivision: "gis",
  },
  {
    id: "spatial-computing",
    label: "Spatial Computing",
    description: "AR/VR / spatial experiences",
    agencyDivision: "spatial-computing",
  },
  {
    id: "game-development",
    label: "Game Development",
    description: "Game design & engineering",
    agencyDivision: "game-development",
  },
  {
    id: "specialized",
    label: "Specialized",
    description: "Cross-cutting specialists (largest roster)",
    agencyDivision: "specialized",
  },
  {
    id: "none",
    label: "Empty roster",
    description: "No bots seeded — add members manually",
    agencyDivision: null,
  },
];

const VALID = new Set(WORKSPACE_DIVISION_OPTIONS.map((o) => o.id));

export function isWorkspaceDivisionId(
  value: unknown,
): value is WorkspaceDivisionId {
  return typeof value === "string" && VALID.has(value as WorkspaceDivisionId);
}

export function resolveWorkspaceDivision(
  input?: {
    division?: string | null;
    seedItRoles?: boolean;
  } | null,
): WorkspaceDivisionId {
  if (input?.division && isWorkspaceDivisionId(input.division)) {
    return input.division;
  }
  if (input?.seedItRoles === false) return "none";
  return "it";
}

/** Map workspace division id → agency-agents folder name. */
export function agencyFolderForDivision(
  division: WorkspaceDivisionId,
): string | null {
  const opt = WORKSPACE_DIVISION_OPTIONS.find((o) => o.id === division);
  return opt?.agencyDivision ?? null;
}
