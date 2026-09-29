import fs from "node:fs";
import path from "node:path";

export type FolderAllowlistFile = {
  folders: string[];
};

function allowlistPath(profileHome: string): string {
  return path.join(profileHome, ".agent", "folder-allowlist.json");
}

function uniqueResolved(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    let real = path.resolve(trimmed);
    try {
      if (fs.existsSync(real)) real = fs.realpathSync(real);
    } catch {
      /* keep resolved */
    }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(real);
  }
  return out;
}

/** Load persisted HITL folder grants for this profile. */
export function loadFolderAllowlist(profileHome: string): string[] {
  const file = allowlistPath(profileHome);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as FolderAllowlistFile;
    const folders = Array.isArray(raw.folders)
      ? raw.folders.map(String)
      : [];
    return uniqueResolved(folders).filter(
      (f) => fs.existsSync(f) && fs.statSync(f).isDirectory(),
    );
  } catch {
    return [];
  }
}

export function saveFolderAllowlist(
  profileHome: string,
  folders: string[],
): string[] {
  const normalized = uniqueResolved(folders).filter(
    (f) => fs.existsSync(f) && fs.statSync(f).isDirectory(),
  );
  const file = allowlistPath(profileHome);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: FolderAllowlistFile = { folders: normalized };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return normalized;
}

/** Persist a newly granted folder (session + reboot). */
export function addFolderAllowlist(
  profileHome: string,
  folderPath: string,
): string[] {
  const current = loadFolderAllowlist(profileHome);
  const resolved = path.resolve(folderPath);
  if (current.some((f) => path.resolve(f) === resolved)) {
    return current;
  }
  return saveFolderAllowlist(profileHome, [...current, resolved]);
}
