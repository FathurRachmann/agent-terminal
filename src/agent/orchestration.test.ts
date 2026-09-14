import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrationTools } from "./orchestration.js";

describe("orchestration tools", () => {
  it("rejects fewer than 3 workers", async () => {
    const [tool] = createOrchestrationTools();
    assert.ok(tool);
    const out = await tool.invoke({
      tasks: [
        { goal: "a", context: "ctx" },
        { goal: "b", context: "ctx" },
      ],
    });
    assert.match(String(out), /at least 3/i);
  });
});
