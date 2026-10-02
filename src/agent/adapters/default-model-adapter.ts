import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import type { ModelAdapter, ModelAdapterOptions } from "../interfaces/model-adapter.js";

export class DefaultModelAdapter implements ModelAdapter {
  public readonly providerName = "openai-compatible";

  public createChatModel(options: ModelAdapterOptions = {}): BaseChatModel {
    return new ChatOpenAI({
      modelName: options.modelName ?? process.env.AGENT_MODEL ?? "gpt-4o",
      temperature: options.temperature ?? 0,
      openAIApiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "dummy",
      configuration: options.baseURL ? { baseURL: options.baseURL } : undefined,
      maxTokens: options.maxTokens,
    });
  }
}
