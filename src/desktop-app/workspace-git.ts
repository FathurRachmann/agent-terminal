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

export type WorkspaceGitBranch = {
  name: string;
  current: boolean;
  remote: boolean;
};

export type WorkspaceGitBranchesResult =
  | { ok: true; current: string | null; branches: WorkspaceGitBranch[] }
  | { ok: false; error: string; current: string | null; branches: WorkspaceGitBranch[] };

/** Local + remote-tracking branch names for the project rail picker. */
export async function listWorkspaceBranches(
  workspaceRoot: string,
): Promise<WorkspaceGitBranchesResult> {
  if (!workspaceRoot) {
    return { ok: false, error: "no workspace", current: null, branches: [] };
  }
  try {
    await git(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ok: false, error: "not a git repo", current: null, branches: [] };
  }

  try {
    const current =
      (await git(workspaceRoot, ["branch", "--show-current"]).catch(() => "")) ||
      null;
    const raw = await git(workspaceRoot, [
      "for-each-ref",
      "--format=%(refname:short)|%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ]);
    const seen = new Set<string>();
    const branches: WorkspaceGitBranch[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [nameRaw, headMark] = line.split("|");
      const name = (nameRaw || "").trim();
      if (!name || name.endsWith("/HEAD")) continue;
      // Remote-tracking only — local `feature/foo` stays local.
      const isRemote =
        name.startsWith("origin/") || name.startsWith("remotes/");
      if (name.startsWith("origin/")) {
        const local = name.slice("origin/".length);
        if (seen.has(local)) continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      branches.push({
        name,
        current: headMark === "*" || name === current,
        remote: isRemote,
      });
    }
    // Mark current explicitly for local branch
    for (const b of branches) {
      if (current && b.name === current) b.current = true;
    }
    branches.sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.remote !== b.remote) return a.remote ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return { ok: true, current, branches };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      current: null,
      branches: [],
    };
  }
}

export type CheckoutBranchResult =
  | { ok: true; branch: string }
  | { ok: false; error: string };

/** Switch to a local branch, or create tracking branch from origin/<name>. */
export async function checkoutWorkspaceBranch(
  workspaceRoot: string,
  branchName: string,
): Promise<CheckoutBranchResult> {
  const target = String(branchName || "").trim();
  if (!workspaceRoot) return { ok: false, error: "no workspace" };
  if (!target) return { ok: false, error: "branch required" };
  if (target.includes("..") || /[\s\\]/.test(target)) {
    return { ok: false, error: "invalid branch name" };
  }

  try {
    await git(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ok: false, error: "not a git repo" };
  }

  try {
    const dirty = await git(workspaceRoot, ["status", "--porcelain"]).catch(
      () => "",
    );
    if (dirty.trim()) {
      return {
        ok: false,
        error:
          "Working tree dirty — commit or stash changes before switching branch.",
      };
    }

    // Local branch exists?
    const locals = await git(workspaceRoot, ["branch", "--list", target]).catch(
      () => "",
    );
    if (locals.trim()) {
      await git(workspaceRoot, ["checkout", target]);
      return { ok: true, branch: target };
    }

    // origin/foo → checkout -b foo --track origin/foo
    const remoteName = target.startsWith("origin/")
      ? target
      : `origin/${target}`;
    const remotes = await git(workspaceRoot, [
      "branch",
      "-r",
      "--list",
      remoteName,
    ]).catch(() => "");
    if (remotes.trim()) {
      const localName = target.startsWith("origin/")
        ? target.slice("origin/".length)
        : target;
      await git(workspaceRoot, [
        "checkout",
        "-B",
        localName,
        "--track",
        remoteName,
      ]);
      return { ok: true, branch: localName };
    }

    return { ok: false, error: `Unknown branch: ${target}` };
  } catch (err) {
    return {
      ok: false,
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
