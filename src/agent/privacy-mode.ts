/**
 * Persist Privacy toggle (ON = project-only sandbox; OFF = whole-machine access).
 */
import fs from "node:fs";
import path from "node:path";

export type PrivacyModeState = {
  /** true = Privacy ON (strict project confinement). */
  enabled: boolean;
};

export function privacyModePath(profileHome: string): string {
  return path.join(path.resolve(profileHome), ".agent", "privacy-mode.json");
}

/** Load Privacy ON/OFF. Default false = Privacy OFF (broad PC access). */
export function loadPrivacyMode(profileHome: string): boolean {
  try {
    const raw = fs.readFileSync(privacyModePath(profileHome), "utf8");
    const parsed = JSON.parse(raw) as Partial<PrivacyModeState>;
    return Boolean(parsed?.enabled);
  } catch {
    return false;
  }
}

export function savePrivacyMode(
  profileHome: string,
  enabled: boolean,
): PrivacyModeState {
  const dir = path.dirname(privacyModePath(profileHome));
  fs.mkdirSync(dir, { recursive: true });
  const state: PrivacyModeState = { enabled: Boolean(enabled) };
  fs.writeFileSync(
    privacyModePath(profileHome),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
  return state;
}

/** Turn nudge injected into each prompt so the model respects the toggle. */
export function privacyModeInstruction(privacyOn: boolean): string {
  if (privacyOn) {
    return [
      "[Privacy ON — project confinement]",
      "Filesystem/shell tools are limited to the project workspace (and any folders the user already approved).",
      "To touch any other path, call request_folder_access first — that opens Approve/Deny. Do not ask in chat text.",
      "Do not claim you can freely browse the whole machine while Privacy is ON.",
    ].join(" ");
  }
  return [
    "[Privacy OFF — full machine access]",
    "Filesystem/shell tools may use the entire PC (allowlist includes the filesystem root).",
    "Do not call request_folder_access and do not ask for folder permission — access is already granted.",
    "Destructive system-wide commands may still need Run Mode / user approval.",
  ].join(" ");
}
