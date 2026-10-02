import "dotenv/config";
import { syncAutoCombos } from "../model-hub/auto-combo-sync.js";

async function main() {
  console.log("Syncing auto combos with Model Hub...");
  const res = await syncAutoCombos();
  if (res.ok) {
    console.log("✅ Auto combos synced successfully.");
  } else {
    console.error("❌ Sync failed:", res.error);
    process.exit(1);
  }
}

main().catch(console.error);