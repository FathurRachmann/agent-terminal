export {
  agentTerminalRoot,
  isValidProfileId,
  PROFILE_ID_RE,
  profileDesktopLogPath,
  profileEnvPath,
  profileHome,
  profileSkillsDir,
  profilesDir,
  registryPath,
  soulPath,
} from "./paths.js";
export {
  DEFAULT_SOUL,
  composeSystemPrompt,
  ensureSoul,
  readSoul,
  writeSoul,
} from "./soul.js";
export {
  cloneProfileContents,
  createProfile,
  getActiveProfileHome,
  listProfileSummaries,
  loadRegistry,
  machineRootExists,
  saveRegistry,
  setActiveProfile,
  setDefaultProfile,
  setGatewayMode,
  summarizeProfile,
  ensureProfileHome,
  type GatewayMode,
  type ProfileRecord,
  type ProfileRegistry,
  type ProfileSummary,
} from "./registry.js";
export { migrateWorkspaceAgentToProfiles } from "./migrate.js";
