import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceGitSummary = {
  ok: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  dirty: boolean;
  error?: string;
};

async function git(
  workspaceRoot: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspaceRoot,
    timeout: 4_000,
    maxBuffer: 512_000,
  });
  return String(stdout || "").trim();
}

/** Best-effort branch + unstaged/staged diffstat for the composer chrome. */
export async function getWorkspaceGitSummary(
  workspaceRoot: string,
): Promise<WorkspaceGitSummary> {
  if (!workspaceRoot) {
    return {
      ok: false,
      branch: null,
      additions: 0,
      deletions: 0,
      dirty: false,
      error: "no workspace",
    };
  }

  try {
    await git(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return {
      ok: false,
      branch: null,
      additions: 0,
      deletions: 0,
      dirty: false,
      error: "not a git repo",
    };
  }

  try {
    const branch =
      (await git(workspaceRoot, ["branch", "--show-current"])) ||
      (await git(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"])) ||
      null;

    // Combined staged + unstaged numstat (ignore merge conflict markers).
    const numstat = await git(workspaceRoot, [
      "diff",
      "--numstat",
      "HEAD",
    ]).catch(() => "");

    let additions = 0;
    let deletions = 0;
    for (const line of numstat.split("\n")) {
      if (!line.trim()) continue;
      const [a, d] = line.split("\t");
      const add = Number(a);
      const del = Number(d);
      if (Number.isFinite(add)) additions += add;
      if (Number.isFinite(del)) deletions += del;
    }

    const dirty =
      additions > 0 ||
      deletions > 0 ||
      Boolean(
        await git(workspaceRoot, ["status", "--porcelain"]).catch(() => ""),
      );

    return { ok: true, branch, additions, deletions, dirty };
  } catch (err) {
    return {
      ok: false,
      branch: null,
      additions: 0,
      deletions: 0,
      dirty: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type WorkspaceChangeEntry = {
  path: string;
  status: string;
};

export type WorkspaceChangesResult =
  | { ok: true; entries: WorkspaceChangeEntry[] }
  | { ok: false; error: string; entries: WorkspaceChangeEntry[] };

/** Porcelain list of changed paths for the REVIEW pane. */
export async function listWorkspaceChanges(
  workspaceRoot: string,
): Promise<WorkspaceChangesResult> {
  if (!workspaceRoot) {
    return { ok: false, error: "no workspace", entries: [] };
  }
  try {
    await git(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ok: false, error: "not a git repo", entries: [] };
  }

  try {
    const out = await git(workspaceRoot, ["status", "--porcelain", "-u"]);
    const entries: WorkspaceChangeEntry[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim() || "??";
      let filePath = line.slice(3).trim();
      // Handle renames: "R  old -> new"
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop()!.trim();
      }
      // Strip surrounding quotes from git
      if (
        (filePath.startsWith('"') && filePath.endsWith('"')) ||
        (filePath.startsWith("'") && filePath.endsWith("'"))
      ) {
        filePath = filePath.slice(1, -1);
      }
      if (!filePath) continue;
      entries.push({ path: filePath.replace(/\\/g, "/"), status });
    }
    return { ok: true, entries };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      entries: [],
    };
  }
}
