import fs from "node:fs";
import path from "node:path";
import {
  mimeForPath,
  restoreAbsolutePathPrefix,
  WA_DOCUMENT_MAX_BYTES,
} from "./file-delivery-shared.js";

export {
  collectChatFileChipPaths,
  collectDeliverablePaths,
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

/** Shallow search for basename under root (prefer working/). */
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
    // Scan working/ up to working/project/<name>/file (depth 3).
    const working = path.join(root, "working");
    try {
      if (!fs.existsSync(working) || !fs.statSync(working).isDirectory()) {
        continue;
      }
      const queue = [working];
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
  if (!hits.length) return null;
  // Prefer declared directory rank; use mtime only to break ties among same-rank hits.
  hits.sort((a, b) => a.rank - b.rank || b.mtimeMs - a.mtimeMs);
  const best = hits[0]!;
  return { abs: best.abs, basename: best.basename, size: best.size };
}

/**
 * Resolve a workspace-relative or absolute path to an existing file under roots.
 * Falls back to basename search under working/ when the exact path is missing
 * (common when the reply truncates a spaced filename to `DIANDRA.doc`).
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
    const root = resolvedRoots.find((r) => isInsideRoot(r, abs));
    if (!root) continue;
    const hit = tryStatFile(abs);
    if (hit) return { ok: true, ...hit };
  }

  const byName = findByBasename(resolvedRoots, path.basename(trimmed));
  if (byName) return { ok: true, ...byName };

  return { ok: false, error: "File not found in project folders" };
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
