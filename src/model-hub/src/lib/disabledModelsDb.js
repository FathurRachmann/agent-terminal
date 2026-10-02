// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getDisabledModels } from "@/lib/db/index.js";

export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "@/lib/db/index.js";

/**
 * Checks whether a given model string (full "provider/modelId" or bare "modelId") is disabled in settings.
 */
export function isModelIdDisabled(modelStr, disabledMap) {
  if (!modelStr || !disabledMap || typeof disabledMap !== "object") return false;
  const str = String(modelStr).trim();
  if (!str) return false;

  const slash = str.indexOf("/");
  const prefix = slash > 0 ? str.slice(0, slash) : "";
  const bare = slash > 0 ? str.slice(slash + 1) : str;

  const candidateKeys = new Set();
  if (prefix) candidateKeys.add(prefix);
  if (prefix && PROVIDER_ID_TO_ALIAS[prefix]) candidateKeys.add(PROVIDER_ID_TO_ALIAS[prefix]);

  // Find reverse mappings in PROVIDER_ID_TO_ALIAS
  for (const [id, alias] of Object.entries(PROVIDER_ID_TO_ALIAS)) {
    if (prefix && (prefix === id || prefix === alias)) {
      candidateKeys.add(id);
      candidateKeys.add(alias);
    }
  }

  // If no prefix (bare model), check all provider arrays in disabledMap
  if (candidateKeys.size === 0) {
    for (const [k, list] of Object.entries(disabledMap)) {
      if (Array.isArray(list) && (list.includes(bare) || list.includes(str))) {
        return true;
      }
    }
    return false;
  }

  for (const k of candidateKeys) {
    const list = disabledMap[k];
    if (Array.isArray(list)) {
      if (list.includes(bare) || list.includes(str) || (prefix && list.includes(`${prefix}/${bare}`))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter an array of model strings removing any that are disabled.
 */
export async function filterActiveComboModels(models) {
  if (!Array.isArray(models) || models.length === 0) return models;
  try {
    const disabledMap = await getDisabledModels();
    return models.filter((m) => !isModelIdDisabled(m, disabledMap));
  } catch {
    return models;
  }
}

