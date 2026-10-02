import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface ModelAdapterOptions {
  modelName?: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
}

export interface ModelAdapter {
  readonly providerName: string;
  createChatModel(options?: ModelAdapterOptions): BaseChatModel;
}
