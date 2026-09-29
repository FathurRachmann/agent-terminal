/**
 * Claude Code-style edit reliability:
 * - On edit_file failure: re-read file + fuzzy matches for old_string so the model can retry.
 * - On success: read back a window around the new_string to confirm the edit landed.
 */
import fs from "node:fs";
import path from "node:path";
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

const MAX_SNIPPET = 3_500;
const CONTEXT_LINES = 12;

export function resolveEditPath(
  workspaceRoot: string,
  filePath: string | null,
): string | null {
  if (!filePath?.trim()) return null;
  const raw = filePath.trim();
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(workspaceRoot, raw.replace(/^\.\//, ""));
}

export function toolArgString(
  args: unknown,
  keys: string[],
): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length) return v;
  }
  return null;
}

export function looksLikeEditFailure(content: string): boolean {
  const t = content.toLowerCase();
  if (!t.trim()) return true;
  if (/^(error|failed|cannot|unable)/i.test(content.trim())) return true;
  if (
    /old_string.*(not found|does not appear|no match|wasn't found|was not found)/i.test(
      content,
    )
  ) {
    return true;
  }
  if (/\berror\b/.test(t) && !/successfully|updated|wrote|edited/.test(t)) {
    return true;
  }
  return false;
}

/** Rank fuzzy line matches for a failed old_string. */
export function findFuzzyLineMatches(
  fileText: string,
  needle: string,
  limit = 5,
): Array<{ line: number; score: number; text: string }> {
  const needleTrim = needle.trim();
  if (!needleTrim) return [];
  const needleLines = needleTrim.split(/\r?\n/);
  const first = needleLines[0]!.trim();
  const lines = fileText.split(/\r?\n/);
  const scored: Array<{ line: number; score: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) continue;
    let score = 0;
    if (trimmed === first) score = 100;
    else if (trimmed.includes(first) || first.includes(trimmed)) score = 70;
    else {
      const a = new Set(trimmed.toLowerCase().split(/\W+/).filter(Boolean));
      const b = new Set(first.toLowerCase().split(/\W+/).filter(Boolean));
      if (a.size && b.size) {
        let inter = 0;
        for (const t of a) if (b.has(t)) inter++;
        const union = a.size + b.size - inter;
        score = Math.round((inter / union) * 60);
      }
    }
    if (score >= 35) {
      scored.push({ line: i + 1, score, text: line.slice(0, 200) });
    }
  }

  return scored.sort((x, y) => y.score - x.score).slice(0, limit);
}

export function snippetAroundMatch(
  fileText: string,
  match: string,
  radius = CONTEXT_LINES,
): string | null {
  if (!match) return null;
  const idx = fileText.indexOf(match);
  if (idx < 0) {
    // try first line only
    const first = match.split(/\r?\n/)[0]?.trim() ?? "";
    if (!first) return null;
    const alt = fileText.indexOf(first);
    if (alt < 0) return null;
    return windowAroundIndex(fileText, alt, first.length, radius);
  }
  return windowAroundIndex(fileText, idx, match.length, radius);
}

function windowAroundIndex(
  fileText: string,
  index: number,
  length: number,
  radius: number,
): string {
  const lines = fileText.split(/\r?\n/);
  let pos = 0;
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = (lines[i]?.length ?? 0) + 1;
    if (pos + lineLen > index) {
      startLine = i;
      break;
    }
    pos += lineLen;
  }
  const endApprox = index + Math.max(length, 1);
  let pos2 = 0;
  let endLine = startLine;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = (lines[i]?.length ?? 0) + 1;
    if (pos2 + lineLen > endApprox) {
      endLine = i;
      break;
    }
    pos2 += lineLen;
    endLine = i;
  }
  const from = Math.max(0, startLine - radius);
  const to = Math.min(lines.length - 1, endLine + radius);
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${String(i + 1).padStart(4, " ")}|${lines[i] ?? ""}`);
  }
  return out.join("\n").slice(0, MAX_SNIPPET);
}

function asToolMessage(result: unknown): ToolMessage | null {
  if (ToolMessage.isInstance(result)) return result;
  return null;
}

function withContent(result: ToolMessage, content: string): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: result.tool_call_id,
    name: result.name,
    status: result.status,
    additional_kwargs: result.additional_kwargs,
    response_metadata: result.response_metadata,
    id: result.id,
    artifact: result.artifact,
  });
}

export type EditRetryMiddlewareOptions = {
  workspaceRoot: string;
  readFile?: (absPath: string) => string;
};

/**
 * Enrich edit_file results with file context on failure and read-back on success.
 */
export function createEditRetryMiddleware(options: EditRetryMiddlewareOptions) {
  const root = path.resolve(options.workspaceRoot);
  const readFile =
    options.readFile ??
    ((abs: string) => fs.readFileSync(abs, "utf8"));

  return createMiddleware({
    name: "EditRetryMiddleware",
    async wrapToolCall(request, handler) {
      const result = await handler(request);
      if (request.toolCall.name !== "edit_file") return result;

      const msg = asToolMessage(result);
      if (!msg) return result;

      const content =
        typeof msg.content === "string" ? msg.content : String(msg.content);
      const filePath = toolArgString(request.toolCall.args, [
        "file_path",
        "path",
        "filePath",
      ]);
      const oldString = toolArgString(request.toolCall.args, ["old_string"]);
      const newString = toolArgString(request.toolCall.args, ["new_string"]);
      const abs = resolveEditPath(root, filePath);

      if (!abs || !fs.existsSync(abs)) {
        if (looksLikeEditFailure(content)) {
          return withContent(
            msg,
            `${content}\n\n[EDIT RETRY HINT]\nFile not readable at ${filePath ?? "(missing)"}. Re-check path with glob/ls, then retry edit_file.`,
          );
        }
        return result;
      }

      let fileText = "";
      try {
        fileText = readFile(abs);
      } catch (err) {
        return withContent(
          msg,
          `${content}\n\n[EDIT RETRY HINT]\nCould not read ${abs}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (looksLikeEditFailure(content)) {
        const matches = oldString
          ? findFuzzyLineMatches(fileText, oldString)
          : [];
        const matchBlock =
          matches.length > 0
            ? matches
                .map(
                  (m) =>
                    `  L${m.line} (score ${m.score}): ${m.text.trim()}`,
                )
                .join("\n")
            : "  (no close line matches — re-read the file)";
        const near =
          oldString && matches[0]
            ? snippetAroundMatch(
                fileText,
                fileText.split(/\r?\n/)[matches[0].line - 1] ?? oldString.split(/\r?\n/)[0]!,
              )
            : snippetAroundMatch(fileText, oldString?.split(/\r?\n/)[0] ?? "");

        return withContent(
          msg,
          [
            content,
            "",
            "[EDIT RETRY HINT]",
            `Path: ${abs}`,
            "old_string did not apply. Closest lines:",
            matchBlock,
            near ? `\nContext:\n${near}` : "",
            "Retry edit_file with an exact contiguous old_string copied from Context above.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      // Success path: confirm new_string (or a distinctive chunk) is present.
      const confirmNeedle =
        (newString && newString.length <= 800 ? newString : null) ||
        newString?.split(/\r?\n/).find((l) => l.trim().length > 8) ||
        null;
      if (confirmNeedle && fileText.includes(confirmNeedle)) {
        const window = snippetAroundMatch(fileText, confirmNeedle);
        return withContent(
          msg,
          [
            content,
            "",
            "[EDIT READ-BACK]",
            `Confirmed in ${abs}:`,
            window || "(match found, window unavailable)",
          ].join("\n"),
        );
      }
      if (confirmNeedle && !fileText.includes(confirmNeedle)) {
        return withContent(
          msg,
          [
            content,
            "",
            "[EDIT READ-BACK WARNING]",
            `new_string not found in ${abs} after reported success — re-read the file and verify.`,
          ].join("\n"),
        );
      }

      return result;
    },
  });
}
