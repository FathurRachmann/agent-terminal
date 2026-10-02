import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PersistentMemoryStore } from "../memory/persistent-store.js";
import type { SessionStore } from "../memory/session-store.js";
import type { EmbeddingClient } from "../memory/embeddings.js";

export type AgentRunnerOptions = {
  workingDirectory?: string;
  modelName?: string;
  interactive?: boolean;
};

export type MemoryRuntime = {
  sessionStore: SessionStore;
  memoryStore: PersistentMemoryStore;
  embedder: EmbeddingClient;
  model: BaseChatModel;
  workspaceRoot: string;
  profileHome?: string;
  enableReflection?: boolean;
};

export class AgentRunner {
  private options: AgentRunnerOptions;

  constructor(options: AgentRunnerOptions = {}) {
    this.options = options;
  }

  public async run(prompt: string): Promise<{ success: boolean; output: string }> {
    if (!prompt.trim()) {
      return { success: false, output: "Empty prompt provided." };
    }
    return {
      success: true,
      output: `Executed prompt successfully in ${this.options.workingDirectory || process.cwd()}`,
    };
  }
}

