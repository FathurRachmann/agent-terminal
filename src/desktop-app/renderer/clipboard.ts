/** Clipboard helpers for code text and diagram (SVG → PNG) images. */

/** Long edge target for exported diagram PNGs (Full HD). */
export const EXPORT_LONG_EDGE_PX = 1920;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Ensure SVG root has xmlns so it can be drawn to canvas. */
export function ensureSvgXmlns(svgMarkup: string): string {
  if (/<svg[^>]*\sxmlns=/.test(svgMarkup)) return svgMarkup;
  return svgMarkup.replace(
    /<svg\b/,
    '<svg xmlns="http://www.w3.org/2000/svg"',
  );
}

/**
 * Resolve full diagram pixel size from viewBox / max-width / absolute attrs.
 * Mermaid emits width="100%" + viewBox — browsers then rasterize at ~300×150
 * and the PNG looks cropped unless we force absolute dimensions.
 */
export function parseSvgRasterSize(
  svgMarkup: string,
): { width: number; height: number } | null {
  const viewBox = /viewBox\s*=\s*["']?\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)/.exec(
    svgMarkup,
  );
  if (viewBox) {
    const width = Math.abs(parseFloat(viewBox[3] ?? "0"));
    const height = Math.abs(parseFloat(viewBox[4] ?? "0"));
    if (width > 0 && height > 0) return { width, height };
  }

  const absWidth = /\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svgMarkup);
  const absHeight = /\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svgMarkup);
  const maxWidth = /max-width\s*:\s*([\d.]+)\s*px/i.exec(svgMarkup);
  const width = parseFloat(absWidth?.[1] ?? maxWidth?.[1] ?? "0");
  const height = parseFloat(absHeight?.[1] ?? "0");
  if (width > 0 && height > 0) return { width, height };
  return null;
}

/** At least 2× retina, and at least Full HD on the long edge. */
export function fullHdExportScale(width: number, height: number): number {
  const longEdge = Math.max(width, height, 1);
  return Math.max(2, EXPORT_LONG_EDGE_PX / longEdge);
}

/** Rewrite SVG root to absolute width/height so <img> rasterizes the full viewBox. */
export function prepareSvgForRaster(svgMarkup: string): {
  svg: string;
  width: number;
  height: number;
} {
  let svg = ensureSvgXmlns(svgMarkup.trim());
  const size = parseSvgRasterSize(svg) ?? { width: 800, height: 600 };

  svg = svg.replace(/<svg\b([^>]*)>/i, (_full, rawAttrs: string) => {
    const attrs = String(rawAttrs)
      .replace(/\swidth\s*=\s*(["']).*?\1/gi, "")
      .replace(/\sheight\s*=\s*(["']).*?\1/gi, "")
      .replace(/\sstyle\s*=\s*(["']).*?\1/gi, "")
      .replace(/\spreserveAspectRatio\s*=\s*(["']).*?\1/gi, "");
    return `<svg${attrs} width="${size.width}" height="${size.height}" preserveAspectRatio="xMidYMid meet">`;
  });

  return { svg, width: size.width, height: size.height };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load SVG as image"));
    img.src = url;
  });
}

export async function svgToPngBlob(
  svgMarkup: string,
  options?: { background?: string | "transparent"; scale?: number },
): Promise<Blob> {
  const background = options?.background ?? "transparent";
  const { svg, width, height } = prepareSvgForRaster(svgMarkup);
  const scale = options?.scale ?? fullHdExportScale(width, height);

  // data: URL is more reliable than blob: for SVG→canvas in Chromium/Electron.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = await loadImage(url);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))),
      "image/png",
    );
  });
}

/**
 * Prefer the live <svg> in the preview DOM (has accurate viewBox / bbox)
 * over the raw markup string.
 */
export async function copySvgElementAsImage(
  svgEl: SVGSVGElement,
): Promise<boolean> {
  try {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    let width = 0;
    let height = 0;

    const vb = svgEl.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      width = vb.width;
      height = vb.height;
    } else {
      try {
        const bbox = svgEl.getBBox();
        width = Math.max(bbox.x + bbox.width, 0);
        height = Math.max(bbox.y + bbox.height, 0);
      } catch {
        /* getBBox fails if not rendered */
      }
    }

    if (!(width > 0 && height > 0)) {
      const rect = svgEl.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }

    if (!(width > 0 && height > 0)) return false;

    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.removeAttribute("style");
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    const markup = new XMLSerializer().serializeToString(clone);
    const png = await svgToPngBlob(markup);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Copy rendered Mermaid/ER SVG as a PNG image (transparent bg, Full HD). */
export async function copySvgAsImage(svgMarkup: string): Promise<boolean> {
  if (!svgMarkup.trim()) return false;
  try {
    const png = await svgToPngBlob(svgMarkup);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-render Mermaid (via provided renderer) then copy as light, transparent, FHD PNG.
 */
export async function copyMermaidSourceAsImage(
  source: string,
  renderLightSvg: (code: string) => Promise<string>,
): Promise<boolean> {
  if (!source.trim()) return false;
  try {
    const svg = await renderLightSvg(source);
    return copySvgAsImage(svg);
  } catch {
    return false;
  }
}
