/**
 * When the model pastes a Python PDF/"laporan" script into the chat instead of
 * calling `execute`, lift the fence into a native execute tool call — or, for
 * empty JSON skeletons, run the bundled generator so the user still gets a PDF.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { isEmptyReportSkeleton } from "./write-persist-middleware.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Repo scripts/ — resolve from src/agent → ../../scripts */
export const BUNDLED_MONTHLY_PDF_SCRIPT = path.resolve(
  SCRIPT_DIR,
  "../../scripts/generate-monthly-financial-pdf.py",
);

export function contentToPlainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

/** Extract first ```python / ```py fence body. */
export function extractPythonFence(text: string): string | null {
  const m = text.match(/```(?:python|py)\s*\n([\s\S]*?)```/i);
  if (m?.[1]?.trim()) return m[1].trim();
  // Glued fence: ```pythonimport → treat rest until end or next ```
  const glued = text.match(/```(?:python|py)(?!\n)([\s\S]*?)(?:```|$)/i);
  if (glued?.[1]?.trim()) {
    const body = glued[1].replace(/^import/, "import").trim();
    // If it started as pythonimport, fix missing newline after python
    if (/^import\b/.test(body) || /from\s+\w+|def\s+|report\s*=/.test(body)) {
      return body;
    }
  }
  return null;
}

export function looksLikePdfLaporanPython(code: string): boolean {
  const c = code;
  const mentionsPdf =
    /\b(fpdf|FPDF|reportlab|PdfPages|\.pdf\b)/i.test(c) ||
    /Laporan|laporan|financial|keuangan/i.test(c);
  const looksScript =
    /\bimport\b/.test(c) &&
    (/FPDF\s*\(/.test(c) ||
      /SimpleDocTemplate|canvas\.Canvas|json\.dump|open\s*\(/.test(c) ||
      /executive_summary/.test(c));
  return mentionsPdf && looksScript;
}

export function isEmptySkeletonPdfDump(code: string): boolean {
  return isEmptyReportSkeleton(code) || (
    /executive_summary/i.test(code) &&
    /:\s*""\s*[,}]/.test(code) &&
    /:\s*\[\s*\]/.test(code) &&
    (/FPDF|reportlab|\.pdf/i.test(code) || /laporan|keuangan/i.test(code))
  );
}

export function bundledMonthlyPdfCommand(options?: {
  month?: string;
  year?: number;
  outRel?: string;
}): string {
  const month = options?.month ?? "Agustus";
  const year = options?.year ?? new Date().getFullYear();
  const outRel =
    options?.outRel ??
    `tmp/bots/laporan_keuangan_bulanan_${month.toLowerCase()}.pdf`;
  const script = BUNDLED_MONTHLY_PDF_SCRIPT;
  return [
    `python3 "${script}"`,
    `--month "${month}"`,
    `--year ${year}`,
    `--out "${outRel}"`,
  ].join(" ");
}

export function promotePdfPythonDumpToExecute(
  message: AIMessage | AIMessageChunk,
): AIMessage | AIMessageChunk {
  const existing =
    "tool_calls" in message && Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];
  if (existing.length > 0) return message;

  const text = contentToPlainText(message.content);
  if (!text.trim()) return message;

  const code = extractPythonFence(text);
  // Also catch unfenced dumps that start with import json / from fpdf
  const rawCode =
    code ??
    (/^\s*(import\s+json|from\s+fpdf|from\s+reportlab)/m.test(text) &&
    looksLikePdfLaporanPython(text)
      ? text.trim()
      : null);

  if (!rawCode || !looksLikePdfLaporanPython(rawCode)) return message;

  let command: string;
  let note: string;
  if (isEmptySkeletonPdfDump(rawCode)) {
    command = bundledMonthlyPdfCommand();
    note =
      "[auto] Empty laporan template pasted in chat — running bundled reportlab generator instead of dumping code.";
  } else {
    command = [
      "mkdir -p tmp/bots",
      `cat > tmp/bots/_agent_pdf_gen.py <<'AGENT_PDF_EOF'\n${rawCode}\nAGENT_PDF_EOF`,
      "python3 tmp/bots/_agent_pdf_gen.py",
    ].join(" && ");
    note =
      "[auto] Promoted pasted Python PDF script to `execute` (do not paste code in chat).";
  }

  const toolCall: ToolCall = {
    name: "execute",
    args: { command },
    id: `auto-pdf-${randomUUID()}`,
    type: "tool_call",
  };

  return new AIMessage({
    content: note,
    additional_kwargs: { ...message.additional_kwargs },
    response_metadata: {
      ...message.response_metadata,
      pdf_python_dump_promoted: true,
    },
    id: message.id,
    tool_calls: [toolCall],
  });
}
