import { dynamicTierRouter } from "../model/dynamic-tier-router.js";
import { fetchModelHubModels, fetchModelHubCombos, createModelHubCombo, updateModelHubCombo } from "../desktop-app/model-hub-bridge.js";

let syncInProgress = false;

/**
 * Idempotently auto-generates or updates tiered combo pools (combo-auto-low, combo-auto-mid, combo-auto-high)
 * based on live active models in Model Hub. Safe to call non-blocking from IPC handlers or startup.
 */
export async function syncAutoCombos(customBaseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  if (syncInProgress) {
    return { ok: true };
  }
  syncInProgress = true;

  try {
    const baseUrl = customBaseUrl || "http://127.0.0.1:27128";
    
    let models;
    try {
      const res = await fetch(`${baseUrl}/v1/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      models = await res.json();
    } catch {
      // Fallback via bridge
      models = await fetchModelHubModels().catch(() => null);
    }

    if (!models?.data?.length) {
      syncInProgress = false;
      return { ok: true };
    }

    let existingCombos: any[] = [];
    try {
      const res = await fetch(`${baseUrl}/api/combos`);
      if (res.ok) {
        const json: any = await res.json();
        existingCombos = json.combos || [];
      } else {
        const bridgeCombos: any = await fetchModelHubCombos().catch(() => null);
        existingCombos = bridgeCombos?.combos || [];
      }
    } catch {
      /* ignore */
    }

    const buckets = { low: [] as string[], mid: [] as string[], high: [] as string[] };

    for (const m of models.data) {
      if (!m?.id) continue;
      const lower = m.id.toLowerCase();

      // Exclude combos to avoid circular nesting
      if (lower.startsWith("combo-auto-") || lower.includes("combo")) {
        continue;
      }

      const tier = dynamicTierRouter.classifyModel(m.id, m.capabilities, m.context_length);
      buckets[tier].push(m.id);
    }

    const syncCombo = async (id: string, name: string, modelsList: string[]) => {
      if (modelsList.length === 0) return;

      const existing = existingCombos.find((c) => c.id === id || c.name === name);
      if (existing) {
        try {
          await fetch(`${baseUrl}/api/combos/${existing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, models: modelsList, kind: "round-robin" }),
          });
        } catch {
          await updateModelHubCombo(existing.id, { name, models: modelsList, kind: "round-robin" }).catch(() => null);
        }
      } else {
        try {
          await fetch(`${baseUrl}/api/combos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, models: modelsList, kind: "round-robin" }),
          });
        } catch {
          await createModelHubCombo({ name, models: modelsList, kind: "round-robin" }).catch(() => null);
        }
      }
    };

    await Promise.all([
      syncCombo("combo-auto-low", "combo-auto-low", buckets.low),
      syncCombo("combo-auto-mid", "combo-auto-mid", buckets.mid),
      syncCombo("combo-auto-high", "combo-auto-high", buckets.high),
    ]);

    syncInProgress = false;
    return { ok: true };
  } catch (err) {
    syncInProgress = false;
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
