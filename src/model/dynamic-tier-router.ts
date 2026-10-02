import { getModelHubStatus } from "../desktop-app/model-hub-runtime.js";
import { fetchModelHubModels } from "../desktop-app/model-hub-bridge.js";

export type ModelTier = "low" | "mid" | "high";
export type WorkflowPhase = "plan" | "execute" | "verify" | "chat";

export interface ResolveModelOptions {
  failureCount?: number;
  preferredTier?: ModelTier;
  fallbackModel?: string;
  excludeModelIds?: string[];
}

export interface CategorizedModels {
  low: string[];
  mid: string[];
  high: string[];
}

export class DynamicTierRouter {
  private cache: CategorizedModels | null = null;
  private lastFetch = 0;
  private readonly CACHE_TTL = 60 * 1000;
  private failedModels = new Map<string, number>();
  private readonly DEFAULT_COOLDOWN_MS = 60 * 1000;

  markModelFailed(modelId: string, errorReason?: string, cooldownMs?: number): void {
    const cooldown = cooldownMs ?? this.DEFAULT_COOLDOWN_MS;
    this.failedModels.set(modelId, Date.now() + cooldown);
  }

  isModelHealthy(modelId: string): boolean {
    const expiresAt = this.failedModels.get(modelId);
    if (!expiresAt) return true;
    if (Date.now() > expiresAt) {
      this.failedModels.delete(modelId);
      return true;
    }
    return false;
  }

  clearFailures(): void {
    this.failedModels.clear();
  }

  setMockCache(categorized: CategorizedModels): void {
    this.cache = categorized;
    this.lastFetch = Date.now();
  }

  async getModels(): Promise<CategorizedModels> {
    const now = Date.now();
    if (this.cache && now - this.lastFetch < this.CACHE_TTL) {
      return this.cache;
    }

    const fallback: CategorizedModels = {
      low: [],
      mid: [process.env.AGENT_MODEL || "gpt-4o-mini"],
      high: [process.env.AGENT_MODEL || "gpt-4o"],
    };

    const status = getModelHubStatus();
    if (!status.ready || !status.baseUrl) {
      return fallback;
    }

    try {
      const res = await fetchModelHubModels();
      if (!res?.data?.length) return fallback;
      
      const categorized: CategorizedModels = { low: [], mid: [], high: [] };
      
      for (const m of res.data) {
        const tier = this.classifyModel(m.id, m.capabilities, m.context_length);
        categorized[tier].push(m.id);
      }
      
      if (categorized.high.length === 0) categorized.high = [...categorized.mid, ...categorized.low];
      if (categorized.low.length === 0) categorized.low = [...categorized.mid, ...categorized.high];
      if (categorized.mid.length === 0) categorized.mid = [...categorized.low, ...categorized.high];

      this.cache = categorized;
      this.lastFetch = now;
      return categorized;
    } catch (e) {
      return fallback;
    }
  }

  classifyModel(id: string, capabilities?: any, contextLength?: number): ModelTier {
    const lower = id.toLowerCase();
    
    // Explicit API capabilities check
    if (capabilities?.tier === "high" || capabilities?.reasoning === true) return "high";
    if (capabilities?.tier === "low" || capabilities?.fast === true) return "low";

    // Parameter size & naming heuristics
    if (/(405b|70b|deepseek-r1|o1|o3|claude-3-5-sonnet|gpt-4o|opus)/i.test(lower)) return "high";
    if (/(8b|7b|3b|1b|haiku|mini|flash|small|lite|nano)/i.test(lower)) return "low";

    // Context length or price fallback
    if (contextLength && contextLength >= 128000 && (capabilities?.reasoning || lower.includes("pro"))) return "high";

    // General heuristics
    if (lower.includes("combo") || lower.includes("free") || lower.includes("router")) return "low";
    if (lower.includes("pro") || lower.includes("large") || lower.includes("reason")) return "high";
    
    return "mid";
  }

  async resolveModelForPhase(phase: WorkflowPhase, options?: ResolveModelOptions): Promise<string> {
    const models = await this.getModels();
    let tier: ModelTier;
    
    if (phase === "plan" || phase === "verify") {
      tier = "high";
    } else {
      tier = "low";
    }

    if (options?.failureCount && options.failureCount > 0) {
      tier = tier === "low" ? "mid" : "high";
      if (options.failureCount > 1) {
        tier = "high";
      }
    }

    if (options?.preferredTier) {
      tier = options.preferredTier;
    }

    const excluded = new Set(options?.excludeModelIds ?? []);

    // 1. In-tier selection (pick first healthy model in current tier)
    const tierModels = models[tier] || [];
    for (const m of tierModels) {
      if (!excluded.has(m) && this.isModelHealthy(m)) {
        return m;
      }
    }

    // 2. Cross-tier graceful degradation (order depends on starting tier)
    const fallbackTiers: ModelTier[] =
      tier === "high" ? ["mid", "low"] : tier === "mid" ? ["low", "high"] : ["mid", "high"];

    for (const altTier of fallbackTiers) {
      const altModels = models[altTier] || [];
      for (const m of altModels) {
        if (!excluded.has(m) && this.isModelHealthy(m)) {
          return m;
        }
      }
    }

    // 3. If all models are unhealthy or excluded, fallback to any available model in the target tier
    if (tierModels.length > 0) {
      return tierModels[0];
    }
    
    return options?.fallbackModel || process.env.AGENT_MODEL || "gpt-4o";
  }
}

export const dynamicTierRouter = new DynamicTierRouter();
