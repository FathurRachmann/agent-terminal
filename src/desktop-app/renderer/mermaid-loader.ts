/** Shared Mermaid init — one initialize() for the whole renderer. */

type MermaidApi = typeof import("mermaid").default;

type MermaidInitConfig = Parameters<MermaidApi["initialize"]>[0];

const FONT = "Plus Jakarta Sans, system-ui, sans-serif";

const DARK_CONFIG: MermaidInitConfig = {
  startOnLoad: false,
  // DOMPurify sanitizes SVG; required for safe dangerouslySetInnerHTML.
  securityLevel: "strict",
  theme: "dark",
  fontFamily: FONT,
  themeVariables: {
    darkMode: true,
    background: "#111113",
    primaryColor: "#1f6feb",
    primaryTextColor: "#ededf0",
    primaryBorderColor: "#6b9fff",
    lineColor: "#8b8b93",
    secondaryColor: "#1e1e21",
    tertiaryColor: "#171719",
    noteBkgColor: "#1e1e21",
    noteTextColor: "#ededf0",
    textColor: "#ededf0",
    actorBkg: "#1e1e21",
    actorBorder: "#6b9fff",
    actorTextColor: "#ededf0",
    signalColor: "#8b8b93",
    signalTextColor: "#ededf0",
  },
};

/** Light theme used only when exporting diagram PNGs to the clipboard. */
const LIGHT_EXPORT_CONFIG: MermaidInitConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "default",
  fontFamily: FONT,
  themeVariables: {
    darkMode: false,
    background: "transparent",
    primaryColor: "#dbeafe",
    primaryTextColor: "#0f172a",
    primaryBorderColor: "#2563eb",
    lineColor: "#64748b",
    secondaryColor: "#f1f5f9",
    tertiaryColor: "#ffffff",
    noteBkgColor: "#fffbeb",
    noteTextColor: "#0f172a",
    textColor: "#0f172a",
    actorBkg: "#f8fafc",
    actorBorder: "#2563eb",
    actorTextColor: "#0f172a",
    signalColor: "#64748b",
    signalTextColor: "#0f172a",
    mainBkg: "#ffffff",
    nodeBorder: "#2563eb",
    clusterBkg: "#f8fafc",
    titleColor: "#0f172a",
    edgeLabelBackground: "#ffffff",
  },
};

let mermaidReady: Promise<MermaidApi> | null = null;
/** Serialize initialize/render so export light theme doesn't race the UI. */
let mermaidLock: Promise<unknown> = Promise.resolve();

export function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize(DARK_CONFIG);
      return mermaid;
    });
  }
  return mermaidReady;
}

function withMermaidLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mermaidLock.then(fn, fn);
  mermaidLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Strip opaque SVG root background so PNG can stay transparent. */
function clearSvgRootBackground(svg: string): string {
  return svg
    .replace(
      /(<svg\b[^>]*\sstyle=")([^"]*)(")/i,
      (_m, pre: string, style: string, post: string) => {
        const cleaned = style
          .replace(/background(?:-color)?\s*:\s*[^;]+;?/gi, "")
          .trim();
        return `${pre}${cleaned}${post}`;
      },
    )
    .replace(/\sfill="(?:#111113|#0d1117|#0a0a0b|#000000|#000)"/gi, ' fill="none"');
}

/**
 * Re-render Mermaid source with a light theme for clipboard export.
 * Restores dark UI config afterwards.
 */
export async function renderMermaidForExport(code: string): Promise<string> {
  return withMermaidLock(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize(LIGHT_EXPORT_CONFIG);
    try {
      const id = `export-${Math.random().toString(36).slice(2, 10)}`;
      const { svg } = await mermaid.render(id, code.trim());
      return clearSvgRootBackground(svg);
    } finally {
      mermaid.initialize(DARK_CONFIG);
    }
  });
}
