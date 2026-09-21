import fs from "node:fs";
import path from "node:path";

/**
 * Atomic JSON write: temp file in the same directory + rename.
 * Reduces torn reads when concurrent IPC handlers update registry/bots/chats.
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, abs);
}

export function readJsonFile<T>(
  file: string,
): { ok: true; data: T } | { ok: false; missing: true } | { ok: false; corrupt: true; error: string } {
  try {
    if (!fs.existsSync(file)) return { ok: false, missing: true };
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) as T };
  } catch (err) {
    return {
      ok: false,
      corrupt: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
