import fs from "node:fs";
import path from "node:path";

const MAX_EXTRACT_CHARS = 80_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export type DocumentExtractResult =
  | { ok: true; text: string; format: string; truncated: boolean }
  | { ok: false; error: string };

function extOf(filePath: string): string {
  const base = path.basename(filePath);
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function clipText(text: string, max = MAX_EXTRACT_CHARS): {
  text: string;
  truncated: boolean;
} {
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (cleaned.length <= max) return { text: cleaned, truncated: false };
  return {
    text: `${cleaned.slice(0, max)}\n\n…(truncated)`,
    truncated: true,
  };
}

async function extractDocx(absPath: string): Promise<DocumentExtractResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: absPath });
  const clipped = clipText(String(result.value || ""));
  if (!clipped.text) {
    return { ok: false, error: "Document appears empty after extraction" };
  }
  return {
    ok: true,
    text: clipped.text,
    format: "docx",
    truncated: clipped.truncated,
  };
}

async function extractSpreadsheet(absPath: string): Promise<DocumentExtractResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.readFile(absPath, { cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 12)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    parts.push(`## Sheet: ${name}\n${csv.trim()}`);
  }
  const clipped = clipText(parts.join("\n\n"));
  if (!clipped.text) {
    return { ok: false, error: "Spreadsheet appears empty" };
  }
  return {
    ok: true,
    text: clipped.text,
    format: "spreadsheet",
    truncated: clipped.truncated,
  };
}

function extractPlainText(absPath: string, format: string): DocumentExtractResult {
  const buf = fs.readFileSync(absPath);
  // Reject obvious binary (NUL in first 4KB) except we already routed office formats.
  const head = buf.subarray(0, Math.min(4096, buf.length));
  if (head.includes(0)) {
    return {
      ok: false,
      error: `Binary .${format} cannot be read as plain text`,
    };
  }
  const clipped = clipText(buf.toString("utf8"));
  return {
    ok: true,
    text: clipped.text,
    format,
    truncated: clipped.truncated,
  };
}

/**
 * Extract readable text from office / text attachments for the agent.
 * Supports: docx, xlsx/xls/xlsm, csv/tsv, and common text formats.
 */
export async function extractDocumentText(
  absPath: string,
): Promise<DocumentExtractResult> {
  const resolved = path.resolve(absPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: "File not found" };
  }
  const size = fs.statSync(resolved).size;
  if (size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `File too large to extract (${Math.ceil(size / (1024 * 1024))}MB)`,
    };
  }

  const ext = extOf(resolved);
  try {
    if (ext === "docx") return await extractDocx(resolved);
    if (ext === "xlsx" || ext === "xls" || ext === "xlsm" || ext === "ods") {
      return await extractSpreadsheet(resolved);
    }
    if (
      [
        "txt",
        "md",
        "markdown",
        "csv",
        "tsv",
        "json",
        "html",
        "htm",
        "xml",
        "rtf",
        "log",
        "yml",
        "yaml",
      ].includes(ext)
    ) {
      return extractPlainText(resolved, ext);
    }
    if (ext === "doc" || ext === "docs") {
      return {
        ok: false,
        error:
          "Legacy .doc format is not supported for text extraction. Convert to .docx or ask the user to re-export.",
      };
    }
    if (ext === "pdf") {
      return {
        ok: false,
        error:
          "PDF text extraction is not available yet. Ask the user for a .docx/.txt copy if needed.",
      };
    }
    // Try utf8 fallback for unknown extensions.
    return extractPlainText(resolved, ext || "bin");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
