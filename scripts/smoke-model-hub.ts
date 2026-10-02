/**
 * Smoke-test Model Hub from copied src/model-hub source.
 * Usage: npx tsx scripts/smoke-model-hub.ts
 */
import path from "node:path";
import os from "node:os";
import {
  startModelHub,
  stopModelHub,
} from "../src/desktop-app/model-hub-runtime.ts";

const profile = path.join(os.tmpdir(), `agent-model-hub-smoke-${Date.now()}`);

const st = await startModelHub(profile);
console.log(JSON.stringify(st, null, 2));
if (!st.ready || !st.baseUrl) {
  console.error("FAIL: not ready", st.error);
  process.exit(1);
}
const health = await fetch(`${st.baseUrl}/api/health`);
console.log("health", health.status, await health.json());
const providers = await fetch(`${st.baseUrl}/api/providers`);
console.log("providers", providers.status, await providers.json());
await stopModelHub();
console.log("stopped OK — source copy at src/model-hub");
