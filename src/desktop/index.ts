export {
  DEFAULT_DESKTOP_APPS,
  loadDesktopAllowlist,
  saveDesktopAllowlist,
  grantDesktopApp,
  isAppAllowed,
  resolveAllowedAppName,
} from "./allowlist.js";
export {
  runDesktopAction,
  validateHttpUrl,
  isMutatingDesktopAction,
  type DesktopActionInput,
  type DesktopActionName,
  type DesktopActionResult,
} from "./actions.js";
export {
  escapeAppleScriptString,
  assertSafeAppName,
  assertSafeKeystroke,
  isDesktopAutomationEnabled,
  isDesktopAutomationSupported,
  KEYSTROKE_MAX_CHARS,
  type KeyModifier,
} from "./macos.js";
export { createDesktopTools } from "./tools.js";
export { parseDesktopIntent, type DesktopIntent } from "./intent.js";
export {
  enrichDesktopIntent,
  extractDesktopFollowUp,
  isPlayMusicFollowUp,
  buildDesktopFollowUpPrompt,
} from "./intent.js";
