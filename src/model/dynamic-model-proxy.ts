import { BaseChatModel, BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { BaseMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { dynamicTierRouter, WorkflowPhase } from "./dynamic-tier-router.js";
import { createRouterModel } from "./9router.js";

export interface DynamicProxyOptions {
  phase?: WorkflowPhase;
  getFailureCount?: () => number;
}

const FAILOVER_ERROR_RE =
  /quota|rate limit|too many requests|429|overloaded|capacity|resource exhausted|insufficient_quota|balance|credit/i;

/**
 * DynamicChatModelProxy dynamically resolves and delegates to the appropriate BaseChatModel
 * per invocation based on workflow phase and current error/retry state.
 * Automatically performs In-Tier Failover and Graceful Degradation on quota/rate-limit errors.
 */
export class DynamicChatModelProxy extends BaseChatModel {
  private phase: WorkflowPhase;
  private getFailureCount?: () => number;
  private currentModelInstance: BaseChatModel | null = null;
  private currentResolvedModelId = "";
  private readonly MAX_FAILOVERS = 3;

  constructor(options?: DynamicProxyOptions, fields?: BaseChatModelParams) {
    super(fields ?? {});
    this.phase = options?.phase ?? "execute";
    this.getFailureCount = options?.getFailureCount;
  }

  _llmType(): string {
    return "dynamic-chat-model-proxy";
  }

  async getDelegateModel(excludedModelIds: string[] = []): Promise<{ model: BaseChatModel; modelId: string }> {
    const failureCount = this.getFailureCount ? this.getFailureCount() : 0;
    const targetModelId = await dynamicTierRouter.resolveModelForPhase(this.phase, {
      failureCount,
      excludeModelIds: excludedModelIds,
    });

    if (!this.currentModelInstance || this.currentResolvedModelId !== targetModelId) {
      this.currentResolvedModelId = targetModelId;
      this.currentModelInstance = await createRouterModel(this.phase, failureCount);
    }

    return { model: this.currentModelInstance, modelId: targetModelId };
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const triedModelIds: string[] = [];
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.MAX_FAILOVERS; attempt++) {
      try {
        const { model, modelId } = await this.getDelegateModel(triedModelIds);
        triedModelIds.push(modelId);
        return await model._generate(messages, options, runManager);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        
        // If it's a quota / rate-limit / capacity error, trigger In-Tier / Cross-Tier Failover
        if (FAILOVER_ERROR_RE.test(msg) && attempt < this.MAX_FAILOVERS) {
          if (this.currentResolvedModelId) {
            dynamicTierRouter.markModelFailed(this.currentResolvedModelId, msg);
          }
          this.currentModelInstance = null;
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  override bindTools(tools: any[], options?: any): any {
    if (this.currentModelInstance && typeof (this.currentModelInstance as any).bindTools === "function") {
      return (this.currentModelInstance as any).bindTools(tools, options);
    }
    return (super.bindTools as any)(tools, options);
  }
}
