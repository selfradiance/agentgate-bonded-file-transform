/**
 * loop-test.ts
 *
 * Full AgentGate loop: create identity → lock bond → execute action → resolve.
 * Proves Agent 001 can perform the complete bonded-action lifecycle.
 *
 * Usage: npx tsx src/loop-test.ts
 */

import "dotenv/config";
import { AgentGateClient, generateKeypair, printStep } from "./agentgate-client";

const BASE_URL = process.env.AGENTGATE_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.AGENTGATE_REST_KEY;

async function main() {
  if (!API_KEY) {
    throw new Error("AGENTGATE_REST_KEY is not set in .env");
  }

  const client = new AgentGateClient(BASE_URL, API_KEY);

  // 1. Generate keypair and create identity
  const keys = generateKeypair();
  console.log("Generated Ed25519 keypair");
  console.log("  publicKey:", keys.publicKey);

  const { identityId, raw: identityResult } = await client.createIdentity(keys.publicKey);
  printStep("Step 1: Create Identity", identityResult);
  console.log(`  identityId: ${identityId}`);

  // 2. Lock a bond (signed)
  const { bondId, raw: lockResult } = await client.lockBond(
    identityId, 100, 300, "loop test", keys.publicKey, keys.privateKey,
  );
  printStep("Step 2: Lock Bond", lockResult);

  // 3. Execute a bonded action (signed)
  const { actionId, raw: executeResult } = await client.executeAction(
    identityId, bondId, "file-transform", { test: true }, 50, keys.publicKey, keys.privateKey,
  );
  printStep("Step 3: Execute Bonded Action", executeResult);

  // 4. Resolve the action as success (signed)
  const resolveResult = await client.resolveAction(actionId, "success", keys.publicKey, keys.privateKey);
  printStep("Step 4: Resolve Action", resolveResult);

  console.log("\n=== Full loop complete ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
