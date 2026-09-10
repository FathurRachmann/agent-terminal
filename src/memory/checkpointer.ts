import path from "node:path";
import fs from "node:fs";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

/**
 * Durable LangGraph checkpoints (thread resume across process restarts).
 */
export function createPersistentCheckpointer(workspaceRoot: string): SqliteSaver {
  const dir = path.join(workspaceRoot, ".agent", "memory");
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "checkpoints.sqlite");
  return SqliteSaver.fromConnString(dbPath);
}
