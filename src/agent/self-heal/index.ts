export {
  ErrorBuffer,
  fingerprintError,
  isSelfHealEligibleError,
} from "./error-buffer.js";
export { parseSelfHealCommand } from "./parse.js";
export {
  buildSelfHealPrompt,
  SELF_HEAL_BOT_INSTRUCTION,
} from "./prompt.js";
export { SelfHealController } from "./controller.js";
export type {
  ErrorRecord,
  SelfHealPhase,
  SelfHealStatus,
  SelfHealTrigger,
} from "./types.js";
