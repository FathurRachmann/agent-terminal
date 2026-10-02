export type AgentRunnerOptions = {
  workingDirectory?: string;
  modelName?: string;
  interactive?: boolean;
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
