/**
 * Cursor-style @ mentions — parse tokens from the user prompt and expand into context.
 *
 * Supported:
 *   @file:path / @filepath / @"path with spaces"
 *   @folder:path / @Folders
 *   @Terminals / @terminal
 *   @Commit / @Git / @Diff
 *   @Branch
 *   @Chats / @chat:<threadId>
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export type MentionKind =
  | "file"
  | "folder"
  | "terminals"
  | "commit"
  | "branch"
  | "chats";

export type ParsedMention = {
  kind: MentionKind;
  /** Raw token as typed (without leading @). */
  raw: string;
  /** Resolved path or id when applicable. */
  target?: string;
  span: { start: number; end: number };
};

const MENTION_RE =
  /@(?:"([^"]+)"|(file|folder|chat):([^\s]+)|(Terminals?|Commit|Branch|Chats|Git|Diff|Folders)\b|([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)|([A-Za-z0-9_./-]+\/))/gi;

export function parseContextMentions(prompt: string): ParsedMention[] {
  const out: ParsedMention[] = [];
  const text = String(prompt || "");
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const quoted = m[1];
    const typed = m[2]?.toLowerCase();
    const typedTarget = m[3];
    const keyword = m[4]?.toLowerCase();
    const fileLike = m[5];
    const folderLike = m[6];

    if (quoted) {
      const looksDir =
        quoted.endsWith("/") ||
        (fs.existsSync(quoted) && fs.statSync(quoted).isDirectory());
      out.push({
        kind: looksDir ? "folder" : "file",
        raw: quoted,
        target: quoted,
        span: { start, end },
      });
      continue;
    }
    if (typed === "file" && typedTarget) {
      out.push({
        kind: "file",
        raw: typedTarget,
        target: typedTarget,
        span: { start, end },
      });
      continue;
    }
    if (typed === "folder" && typedTarget) {
      out.push({
        kind: "folder",
        raw: typedTarget,
        target: typedTarget,
        span: { start, end },
      });
      continue;
    }
    if (typed === "chat" && typedTarget) {
      out.push({
        kind: "chats",
        raw: typedTarget,
        target: typedTarget,
        span: { start, end },
      });
      continue;
    }
    if (keyword === "terminals" || keyword === "terminal") {
      out.push({ kind: "terminals", raw: keyword, span: { start, end } });
      continue;
    }
    if (
      keyword === "commit" ||
      keyword === "git" ||
      keyword === "diff"
    ) {
      out.push({ kind: "commit", raw: keyword, span: { start, end } });
      continue;
    }
    if (keyword === "branch") {
      out.push({ kind: "branch", raw: keyword, span: { start, end } });
      continue;
    }
    if (keyword === "chats") {
      out.push({ kind: "chats", raw: keyword, span: { start, end } });
      continue;
    }
    if (keyword === "folders") {
      out.push({ kind: "folder", raw: keyword, span: { start, end } });
      continue;
    }
    if (fileLike) {
      out.push({
        kind: "file",
        raw: fileLike,
        target: fileLike,
        span: { start, end },
      });
      continue;
    }
    if (folderLike) {
      out.push({
        kind: "folder",
        raw: folderLike.replace(/\/$/, ""),
        target: folderLike.replace(/\/$/, ""),
        span: { start, end },
      });
    }
  }
  return out;
}

function resolvePath(workspaceRoot: string, target: string): string {
  if (path.isAbsolute(target)) return path.normalize(target);
  return path.resolve(workspaceRoot, target);
}

function readFileSnippet(filePath: string, maxChars = 12_000): string {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return `(missing file: ${filePath})`;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}\n… [truncated ${raw.length - maxChars} chars]`;
  } catch (e) {
    return `(error reading ${filePath}: ${e instanceof Error ? e.message : String(e)})`;
  }
}

function listFolderSnippet(dirPath: string, maxEntries = 80): string {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return `(missing folder: ${dirPath})`;
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const lines = entries.slice(0, maxEntries).map((e) => {
      const mark = e.isDirectory() ? "/" : "";
      return `${e.name}${mark}`;
    });
    const more =
      entries.length > maxEntries
        ? `\n… +${entries.length - maxEntries} more`
        : "";
    return lines.join("\n") + more;
  } catch (e) {
    return `(error listing ${dirPath}: ${e instanceof Error ? e.message : String(e)})`;
  }
}

function gitDiff(workspaceRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 2_000_000,
      timeout: 8_000,
    }).trim();
  } catch (e) {
    return `(git ${args.join(" ")} failed: ${e instanceof Error ? e.message : String(e)})`;
  }
}

export type MentionExpandOptions = {
  workspaceRoot: string;
  /** Recent terminal / PTY log text. */
  terminalLog?: string;
  /** Optional chat transcript snippet for @Chats. */
  chatTranscript?: string;
  resolveChatTranscript?: (threadId?: string) => string | undefined;
};

export type ExpandedMention = {
  mention: ParsedMention;
  title: string;
  body: string;
};

export function expandContextMentions(
  mentions: ParsedMention[],
  options: MentionExpandOptions,
): ExpandedMention[] {
  const out: ExpandedMention[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    const key = `${mention.kind}:${mention.target ?? mention.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (mention.kind === "file" && mention.target) {
      const abs = resolvePath(options.workspaceRoot, mention.target);
      out.push({
        mention,
        title: `@file ${path.relative(options.workspaceRoot, abs) || abs}`,
        body: readFileSnippet(abs),
      });
      continue;
    }
    if (mention.kind === "folder") {
      const abs = resolvePath(
        options.workspaceRoot,
        mention.target || options.workspaceRoot,
      );
      out.push({
        mention,
        title: `@folder ${path.relative(options.workspaceRoot, abs) || "."}`,
        body: listFolderSnippet(abs),
      });
      continue;
    }
    if (mention.kind === "terminals") {
      const log = (options.terminalLog || "").trim();
      out.push({
        mention,
        title: "@Terminals",
        body: log
          ? log.slice(-8_000)
          : "(no recent terminal output captured)",
      });
      continue;
    }
    if (mention.kind === "commit") {
      const staged = gitDiff(options.workspaceRoot, ["diff", "--cached"]);
      const unstaged = gitDiff(options.workspaceRoot, ["diff"]);
      const status = gitDiff(options.workspaceRoot, ["status", "--short"]);
      out.push({
        mention,
        title: "@Commit (working tree diff)",
        body: [
          "## git status --short",
          status || "(clean)",
          "",
          "## git diff --cached",
          staged || "(empty)",
          "",
          "## git diff",
          unstaged || "(empty)",
        ].join("\n"),
      });
      continue;
    }
    if (mention.kind === "branch") {
      const against = gitDiff(options.workspaceRoot, [
        "diff",
        "main...HEAD",
      ]);
      const againstMaster = against.startsWith("(git")
        ? gitDiff(options.workspaceRoot, ["diff", "master...HEAD"])
        : against;
      out.push({
        mention,
        title: "@Branch (diff vs main)",
        body: againstMaster || "(no branch diff)",
      });
      continue;
    }
    if (mention.kind === "chats") {
      const fromResolver = options.resolveChatTranscript?.(mention.target);
      const body =
        fromResolver ||
        options.chatTranscript ||
        "(no prior chat transcript available)";
      out.push({
        mention,
        title: mention.target ? `@chat:${mention.target}` : "@Chats",
        body: body.slice(-10_000),
      });
    }
  }
  return out;
}

/** Build a nudge block prepended to the user turn. */
export function formatMentionContextBlock(
  expanded: ExpandedMention[],
): string {
  if (!expanded.length) return "";
  const parts = expanded.map(
    (e) =>
      `### ${e.title}\n\`\`\`\n${e.body.replace(/```/g, "'''")}\n\`\`\``,
  );
  return [
    "[ATTACHED CONTEXT — user @ mentions]",
    "Use the following attached context. Prefer it over guessing paths.",
    ...parts,
  ].join("\n\n");
}

export function buildMentionContextNudge(
  prompt: string,
  options: MentionExpandOptions,
): { nudge: string; mentions: ParsedMention[] } {
  const mentions = parseContextMentions(prompt);
  if (!mentions.length) return { nudge: "", mentions: [] };
  const expanded = expandContextMentions(mentions, options);
  return { nudge: formatMentionContextBlock(expanded), mentions };
}
