/** Shared Mermaid init — one initialize() for the whole renderer. */

type MermaidApi = typeof import("mermaid").default;

type MermaidInitConfig = Parameters<MermaidApi["initialize"]>[0];

const FONT = "IBM Plex Sans, Segoe UI, system-ui, sans-serif";

const DARK_CONFIG: MermaidInitConfig = {
  startOnLoad: false,
  // DOMPurify sanitizes SVG; required for safe dangerouslySetInnerHTML.
  securityLevel: "strict",
  theme: "dark",
  fontFamily: FONT,
  themeVariables: {
    darkMode: true,
    background: "#0d1117",
    primaryColor: "#1f6feb",
    primaryTextColor: "#e7ecf3",
    primaryBorderColor: "#388bfd",
    lineColor: "#8b98a8",
    secondaryColor: "#161b22",
    tertiaryColor: "#121821",
    noteBkgColor: "#151c27",
    noteTextColor: "#e7ecf3",
    textColor: "#e7ecf3",
    actorBkg: "#161b22",
    actorBorder: "#58a6ff",
    actorTextColor: "#e7ecf3",
    signalColor: "#8b98a8",
    signalTextColor: "#e7ecf3",
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
    .replace(/\sfill="(?:#0d1117|#000000|#000)"/gi, ' fill="none"');
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
