import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  mimeForPath,
  isDeliverableChatPath,
  restoreAbsolutePathPrefix,
  WA_DOCUMENT_MAX_BYTES,
} from "./file-delivery-shared.js";

export {
  collectChatFileChipPaths,
  collectDeliverablePaths,
  dropTruncatedBasenames,
  isChatFileChipPath,
  isDeliverableChatPath,
  isProseFalsePositivePath,
  mimeForPath,
  restoreAbsolutePathPrefix,
  WA_DOCUMENT_MAX_BYTES,
} from "./file-delivery-shared.js";

function isInsideRoot(root: string, abs: string): boolean {
  const r = path.resolve(root);
  const a = path.resolve(abs);
  const rel = path.relative(r, a);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function tryStatFile(
  abs: string,
): { abs: string; basename: string; size: number } | null {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { abs, basename: path.basename(abs), size: st.size };
  } catch {
    return null;
  }
}

/** Shallow search for basename under root (prefer tmp/, also legacy working/). */
function findByBasename(
  roots: string[],
  basename: string,
): { abs: string; basename: string; size: number } | null {
  const base = path.basename(basename);
  if (!base || base === "." || base === "..") return null;

  const matchesName = (name: string): boolean => {
    if (name === base) return true;
    // Truncated extract like "DIANDRA.doc" from "... - DIANDRA.doc"
    if (name.endsWith(` ${base}`) || name.endsWith(`-${base}`) || name.endsWith(` - ${base}`)) {
      return true;
    }
    return false;
  };

  const preferSubs = [
    "tmp",
    path.join("tmp", "global"),
    path.join("tmp", "bots"),
    path.join("tmp", "project"),
    path.join("tmp", "uploads"),
    path.join("tmp", "global", "uploads"),
    path.join("tmp", "bots", "uploads"),
    "working",
    path.join("working", "global"),
    path.join("working", "bots"),
    path.join("working", "project"),
    path.join("working", "uploads"),
    path.join("working", "global", "uploads"),
    path.join("working", "bots", "uploads"),
    "",
  ];
  type Hit = { abs: string; basename: string; size: number; mtimeMs: number; rank: number };
  const hits: Hit[] = [];
  let rank = 0;
  for (const root of roots) {
    for (const sub of preferSubs) {
      const dir = sub ? path.join(root, sub) : root;
      const abs = path.join(dir, base);
      try {
        const st = fs.statSync(abs);
        if (st.isFile() && isInsideRoot(root, abs)) {
          hits.push({
            abs,
            basename: path.basename(abs),
            size: st.size,
            mtimeMs: st.mtimeMs,
            rank,
          });
        }
      } catch {
        /* miss */
      }
      rank += 1;
    }
    // Scan tmp/ and legacy working/ up to project/<name>/file (depth 3).
    for (const artifactSeg of ["tmp", "working"] as const) {
      const artifactRoot = path.join(root, artifactSeg);
      try {
        if (
          !fs.existsSync(artifactRoot) ||
          !fs.statSync(artifactRoot).isDirectory()
        ) {
          continue;
        }
        const queue = [artifactRoot];
        let depth = 0;
        while (queue.length && depth < 3) {
          const levelCount = queue.length;
          for (let i = 0; i < levelCount; i++) {
            const dir = queue.shift()!;
            let entries: string[];
            try {
              entries = fs.readdirSync(dir);
            } catch {
              continue;
            }
            for (const name of entries) {
              const child = path.join(dir, name);
              let st: fs.Stats;
              try {
                st = fs.lstatSync(child);
              } catch {
                continue;
              }
              if (st.isSymbolicLink()) continue;
              if (st.isFile() && matchesName(name) && isInsideRoot(root, child)) {
                hits.push({
                  abs: child,
                  basename: name,
                  size: st.size,
                  mtimeMs: st.mtimeMs,
                  rank: 1000 + depth,
                });
              }
              if (st.isDirectory()) queue.push(child);
            }
          }
          depth += 1;
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!hits.length) return null;
  // Prefer declared directory rank; use mtime only to break ties among same-rank hits.
  hits.sort((a, b) => a.rank - b.rank || b.mtimeMs - a.mtimeMs);
  const best = hits[0]!;
  return { abs: best.abs, basename: best.basename, size: best.size };
}

/** Common user folders where agent-discovered deliverables often live. */
function userContentDirs(): string[] {
  const home = os.homedir();
  if (!home) return [];
  return ["Downloads", "Desktop", "Documents"]
    .map((name) => path.join(home, name))
    .filter((dir) => {
      try {
        return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * Find basename under dirs (BFS). Used for ~/Downloads nested folders
 * (e.g. "Bahan Tayang…/Materi 1…/Kata Kami- ….pdf").
 */
export function findByBasenameUnderDirs(
  dirs: string[],
  basename: string,
  maxDepth = 6,
): { abs: string; basename: string; size: number } | null {
  const base = path.basename(String(basename || "").trim());
  if (!base || base === "." || base === "..") return null;

  const matchesName = (name: string): boolean => {
    if (name === base) return true;
    if (
      name.endsWith(` ${base}`) ||
      name.endsWith(`-${base}`) ||
      name.endsWith(` - ${base}`)
    ) {
      return true;
    }
    return false;
  };

  type Hit = {
    abs: string;
    basename: string;
    size: number;
    mtimeMs: number;
    depth: number;
  };
  const hits: Hit[] = [];

  for (const root of dirs) {
    let rootResolved: string;
    try {
      rootResolved = path.resolve(root);
      if (!fs.existsSync(rootResolved) || !fs.statSync(rootResolved).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    // Fast path: direct child
    const direct = tryStatFile(path.join(rootResolved, base));
    if (direct) {
      hits.push({ ...direct, mtimeMs: Date.now(), depth: 0 });
    }

    const queue: Array<{ dir: string; depth: number }> = [
      { dir: rootResolved, depth: 0 },
    ];
    while (queue.length) {
      const { dir, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name === "." || name === ".." || name.startsWith(".")) continue;
        // Skip heavy / irrelevant trees in user folders.
        if (
          /^(node_modules|Library|\.git|\.Trash|Applications|Caches)$/i.test(
            name,
          )
        ) {
          continue;
        }
        const child = path.join(dir, name);
        let st: fs.Stats;
        try {
          st = fs.lstatSync(child);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue;
        if (st.isFile() && matchesName(name)) {
          hits.push({
            abs: child,
            basename: name,
            size: st.size,
            mtimeMs: st.mtimeMs,
            depth: depth + 1,
          });
          // Exact basename at this depth — good enough, keep scanning siblings
          // at same depth only via queue order; early return after loop if exact.
        } else if (st.isDirectory()) {
          queue.push({ dir: child, depth: depth + 1 });
        }
      }
      // Prefer exact name match as soon as we have one at this depth.
      const exact = hits.find((h) => h.basename === base);
      if (exact && exact.depth <= depth + 1) {
        return { abs: exact.abs, basename: exact.basename, size: exact.size };
      }
    }
  }

  if (!hits.length) return null;
  // Prefer shallower + newer
  hits.sort((a, b) => a.depth - b.depth || b.mtimeMs - a.mtimeMs);
  const best = hits[0]!;
  return { abs: best.abs, basename: best.basename, size: best.size };
}

/**
 * Resolve a workspace-relative or absolute path to an existing file.
 * Prefer roots (project / artifact home); absolute paths that exist outside
 * roots are still accepted so Canvas can preview Downloads / Desktop files.
 * Falls back to basename search under working/tmp and common user folders
 * (including nested Downloads subfolders).
 */
export function resolveExistingWorkspaceFile(
  roots: string[],
  requestedPath: string,
): { ok: true; abs: string; basename: string; size: number } | { ok: false; error: string } {
  const trimmed = restoreAbsolutePathPrefix(
    String(requestedPath || "").trim().replace(/\\/g, "/"),
  );
  if (!trimmed) return { ok: false, error: "path required" };
  const resolvedRoots = [
    ...new Set(roots.map((r) => path.resolve(r)).filter(Boolean)),
  ];
  if (!resolvedRoots.length) return { ok: false, error: "No workspace folders" };

  const candidates: string[] = [];
  if (path.isAbsolute(trimmed)) {
    candidates.push(path.resolve(trimmed));
  } else {
    // Leading `/` may have been stripped (`var/folders/...` or `Users/...`).
    candidates.push(path.resolve("/", trimmed));
    for (const root of resolvedRoots) {
      candidates.push(path.resolve(root, trimmed));
    }
  }

  for (const abs of candidates) {
    const inside = resolvedRoots.some((r) => isInsideRoot(r, abs));
    if (!inside) {
      // Outside roots only when the caller asked for an absolute path
      // (incl. restored `/Users/...`). Relative `../secret` stays sandboxed.
      if (!path.isAbsolute(trimmed)) continue;
      const hit = tryStatFile(abs);
      if (hit) return { ok: true, ...hit };
      continue;
    }
    const hit = tryStatFile(abs);
    if (hit) return { ok: true, ...hit };
  }

  const byName = findByBasename(resolvedRoots, path.basename(trimmed));
  if (byName) return { ok: true, ...byName };

  const base = path.basename(trimmed);
  // Nested ~/Downloads search is expensive — only for real deliverable names,
  // never for path-escape attempts (`../secret`).
  if (
    base &&
    base !== "." &&
    base !== ".." &&
    !trimmed.split(/[/\\]/).includes("..") &&
    isDeliverableChatPath(base)
  ) {
    const inUser = findByBasenameUnderDirs(userContentDirs(), base, 5);
    if (inUser) return { ok: true, ...inUser };
  }

  return { ok: false, error: "File not found" };
}

export function readFileForDelivery(
  roots: string[],
  requestedPath: string,
  maxBytes = WA_DOCUMENT_MAX_BYTES,
):
  | {
      ok: true;
      abs: string;
      basename: string;
      mime: string;
      size: number;
      buffer: Buffer;
    }
  | { ok: false; error: string } {
  const prepared = prepareFileForDelivery(roots, requestedPath, maxBytes);
  if (!prepared.ok) return prepared;
  try {
    // Prefer streaming for large payloads; still expose buffer for small callers.
    if (prepared.size > 32 * 1024 * 1024) {
      return {
        ok: false,
        error:
          "File is large — use prepareFileForDelivery + sendDocument(filePath) instead of buffering.",
      };
    }
    const buffer = fs.readFileSync(prepared.abs);
    return {
      ok: true,
      abs: prepared.abs,
      basename: prepared.basename,
      mime: prepared.mime,
      size: buffer.length,
      buffer,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Resolve a deliverable without loading it into memory (safe up to 1GB).
 */
export function prepareFileForDelivery(
  roots: string[],
  requestedPath: string,
  maxBytes = WA_DOCUMENT_MAX_BYTES,
):
  | {
      ok: true;
      abs: string;
      basename: string;
      mime: string;
      size: number;
    }
  | { ok: false; error: string } {
  const resolved = resolveExistingWorkspaceFile(roots, requestedPath);
  if (!resolved.ok) return resolved;
  if (resolved.size > maxBytes) {
    return {
      ok: false,
      error: `File too large (${Math.ceil(resolved.size / (1024 * 1024))}MB). Max ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
    };
  }
  return {
    ok: true,
    abs: resolved.abs,
    basename: resolved.basename,
    mime: mimeForPath(resolved.abs),
    size: resolved.size,
  };
}
