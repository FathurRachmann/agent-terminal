import { tool } from "langchain";
import { z } from "zod";
import path from "node:path";
import { extractDocumentText } from "../desktop-app/document-extract.js";

/**
 * Read Word/Excel/text documents as plain text (docx via mammoth, sheets via xlsx).
 * Prefer this over read_file for .docx/.xlsx — those are binary ZIP packages.
 */
export function createDocumentTools(workspaceRoot: string) {
  const readDocument = tool(
    async ({ file_path }: { file_path: string }) => {
      const trimmed = String(file_path || "").trim();
      if (!trimmed) return "Error: file_path required";
      const abs = path.isAbsolute(trimmed)
        ? path.resolve(trimmed)
        : path.resolve(workspaceRoot, trimmed);
      const extracted = await extractDocumentText(abs);
      if (!extracted.ok) {
        return `Error reading document '${trimmed}': ${extracted.error}`;
      }
      const note = extracted.truncated ? " (truncated)" : "";
      return `Document text (${extracted.format})${note} from ${trimmed}:\n\n${extracted.text}`;
    },
    {
      name: "read_document",
      description:
        "Extract readable text from Word (.docx), Excel (.xlsx/.xls), CSV, Markdown, or other text documents. Use this instead of read_file for .docx/.xlsx — those are binary and cannot be read as UTF-8.",
      schema: z.object({
        file_path: z
          .string()
          .describe(
            "Workspace-relative or absolute path to the document (e.g. working/uploads/laporan.docx)",
          ),
      }),
    },
  );

  return [readDocument];
}
