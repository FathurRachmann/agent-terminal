const STORAGE_KEY = "agent.desktop.layout.v1";

export type LayoutTemplateId =
  | "default"
  | "focus"
  | "terminal-deck"
  | "quad";

export type LayoutPrefs = {
  sidebarWidth: number;
  railWidth: number;
  sidebarOpen: boolean;
  railOpen: boolean;
  /** When true, activity rail is on the left of chat (swapped). */
  swapped: boolean;
  templateId: LayoutTemplateId;
  terminalOpen: boolean;
  terminalHeight: number;
};

export const LAYOUT_DEFAULTS: LayoutPrefs = {
  sidebarWidth: 280,
  railWidth: 400,
  sidebarOpen: true,
  railOpen: true,
  swapped: false,
  templateId: "default",
  terminalOpen: false,
  terminalHeight: 220,
};

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
export const RAIL_MIN = 280;
export const RAIL_MAX = 640;
export const TERMINAL_MIN = 120;
export const TERMINAL_MAX = 480;

export const LAYOUT_TEMPLATES: Array<{
  id: LayoutTemplateId;
  label: string;
}> = [
  { id: "default", label: "Default" },
  { id: "focus", label: "Focus" },
  { id: "terminal-deck", label: "Terminal deck" },
  { id: "quad", label: "Quad" },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isTemplateId(v: unknown): v is LayoutTemplateId {
  return (
    v === "default" ||
    v === "focus" ||
    v === "terminal-deck" ||
    v === "quad"
  );
}

/** Apply a named template onto existing size prefs (keeps widths). */
export function applyLayoutTemplate(
  current: LayoutPrefs,
  templateId: LayoutTemplateId,
): LayoutPrefs {
  const base = {
    ...current,
    templateId,
    swapped: false,
  };
  switch (templateId) {
    case "focus":
      return {
        ...base,
        sidebarOpen: true,
        railOpen: false,
        terminalOpen: false,
      };
    case "terminal-deck":
      return {
        ...base,
        sidebarOpen: true,
        railOpen: false,
        terminalOpen: true,
        terminalHeight: clamp(
          current.terminalHeight || LAYOUT_DEFAULTS.terminalHeight,
          TERMINAL_MIN,
          TERMINAL_MAX,
        ),
      };
    case "quad":
      return {
        ...base,
        sidebarOpen: true,
        railOpen: true,
        terminalOpen: true,
        terminalHeight: clamp(
          current.terminalHeight || LAYOUT_DEFAULTS.terminalHeight,
          TERMINAL_MIN,
          TERMINAL_MAX,
        ),
      };
    case "default":
    default:
      return {
        ...base,
        sidebarOpen: true,
        railOpen: true,
        terminalOpen: false,
      };
  }
}

export function normalizeLayoutPrefs(
  parsed: Partial<LayoutPrefs> | null | undefined,
): LayoutPrefs {
  const templateId = isTemplateId(parsed?.templateId)
    ? parsed!.templateId
    : LAYOUT_DEFAULTS.templateId;
  const withSizes: LayoutPrefs = {
    sidebarWidth: clamp(
      Number(parsed?.sidebarWidth) || LAYOUT_DEFAULTS.sidebarWidth,
      SIDEBAR_MIN,
      SIDEBAR_MAX,
    ),
    railWidth: clamp(
      Number(parsed?.railWidth) || LAYOUT_DEFAULTS.railWidth,
      RAIL_MIN,
      RAIL_MAX,
    ),
    sidebarOpen:
      typeof parsed?.sidebarOpen === "boolean"
        ? parsed.sidebarOpen
        : LAYOUT_DEFAULTS.sidebarOpen,
    railOpen:
      typeof parsed?.railOpen === "boolean"
        ? parsed.railOpen
        : LAYOUT_DEFAULTS.railOpen,
    swapped:
      typeof parsed?.swapped === "boolean"
        ? parsed.swapped
        : LAYOUT_DEFAULTS.swapped,
    templateId,
    terminalOpen:
      typeof parsed?.terminalOpen === "boolean"
        ? parsed.terminalOpen
        : LAYOUT_DEFAULTS.terminalOpen,
    terminalHeight: clamp(
      Number(parsed?.terminalHeight) || LAYOUT_DEFAULTS.terminalHeight,
      TERMINAL_MIN,
      TERMINAL_MAX,
    ),
  };

  // Legacy saves without templateId: infer from booleans when possible.
  if (!isTemplateId(parsed?.templateId)) {
    if (withSizes.terminalOpen && withSizes.railOpen) {
      return { ...withSizes, templateId: "quad" };
    }
    if (withSizes.terminalOpen && !withSizes.railOpen) {
      return { ...withSizes, templateId: "terminal-deck" };
    }
    if (!withSizes.railOpen && !withSizes.terminalOpen) {
      return { ...withSizes, templateId: "focus" };
    }
  }
  return withSizes;
}

export function loadLayoutPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...LAYOUT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return normalizeLayoutPrefs(parsed);
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
}

export function saveLayoutPrefs(prefs: LayoutPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function resetLayoutPrefs(): LayoutPrefs {
  const next = applyLayoutTemplate({ ...LAYOUT_DEFAULTS }, "default");
  saveLayoutPrefs(next);
  return next;
}
