/**
 * cli.ts
 *
 * Main entry point for Agent 001 — File Transform.
 * Reads a task contract, runs the full AgentGate bonded-action lifecycle,
 * performs the transform, verifies the output, and resolves.
 *
 * Usage: npx tsx src/cli.ts <contract.json>
 */

import "dotenv/config";
import fs from "node:fs";
import { TaskContractSchema } from "./contract";
import { AgentGateClient, generateKeypair } from "./agentgate-client";
import { csvToJson } from "./transform";
import { computeHash, verifyOutput } from "./verify";

// AgentGate applies a 1.2x risk multiplier to declared exposure.
// Reverse-engineer the max declarable exposure that fits within the bond.
const AGENTGATE_RISK_MULTIPLIER = 1.2;

const BASE_URL = process.env.AGENTGATE_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.AGENTGATE_REST_KEY;

async function main() {
  // 0. Read and validate contract
  const contractPath = process.argv[2];
  if (!contractPath) {
    console.error("Usage: tsx src/cli.ts <contract.json>");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const parsed = TaskContractSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Contract validation failed:");
    console.error(parsed.error.format());
    process.exit(1);
  }
  const contract = parsed.data;
  console.log(`Contract: ${contractPath}`);
  console.log(`  task: ${contract.task}`);
  console.log(`  transform: ${contract.transform_type}`);
  console.log(`  input:  ${contract.input_file}`);
  console.log(`  output: ${contract.output_file}`);

  if (!API_KEY) {
    throw new Error("AGENTGATE_REST_KEY is not set in .env");
  }

  const client = new AgentGateClient(BASE_URL, API_KEY);

  // 1. Create identity
  const keys = generateKeypair();
  const { identityId } = await client.createIdentity(keys.publicKey, keys.privateKey);
  console.log(`\nIdentity created: ${identityId}`);

  // 2. Lock bond
  const { bondId } = await client.lockBond(
    identityId,
    contract.bond_amount_cents,
    contract.ttl_seconds,
    `file-transform: ${contract.input_file}`,
    keys.publicKey,
    keys.privateKey,
  );
  console.log(`Bond locked: ${bondId} (${contract.bond_amount_cents} cents, ${contract.ttl_seconds}s TTL)`);

  // 3. Execute bonded action
  const { actionId } = await client.executeAction(
    identityId,
    bondId,
    "file-transform",
    contract,
    Math.floor(contract.bond_amount_cents / AGENTGATE_RISK_MULTIPLIER),
    keys.publicKey,
    keys.privateKey,
  );
  console.log(`Action started: ${actionId}`);

  // 4. Run the transform
  console.log(`\nTransforming ${contract.input_file} → ${contract.output_file}...`);
  csvToJson(contract.input_file, contract.output_file);
  console.log("Transform complete.");

  // 5. Verify the output
  const actualHash = computeHash(contract.output_file);
  const verified = verifyOutput(contract.output_file, contract.expected_output_hash);

  // 6. Resolve the action
  const outcome = verified ? "success" : "failed";
  const resolveResult = await client.resolveAction(actionId, outcome, keys.publicKey, keys.privateKey);

  // Check if AgentGate actually accepted the resolution
  const serverAccepted = resolveResult.status >= 200 && resolveResult.status < 300;
  const rb = resolveResult.body;

  // 7. Print summary
  console.log("\n========================================");
  console.log("  AGENT 001 — EXECUTION SUMMARY");
  console.log("========================================");
  console.log(`  Contract:      ${contractPath}`);
  console.log(`  Transform:     ${contract.transform_type} (${contract.input_file} → ${contract.output_file})`);
  console.log(`  Expected hash: ${contract.expected_output_hash}`);
  console.log(`  Actual hash:   ${actualHash}`);
  console.log(`  Verification:  ${verified ? "PASS" : "FAIL"}`);
  console.log(`  Resolution:    ${serverAccepted ? outcome : "REJECTED BY SERVER"}`);
  if (!serverAccepted) {
    console.log(`  Server error:  ${resolveResult.status} ${resolveResult.statusText}`);
    console.log(`  Server body:   ${JSON.stringify(rb)}`);
  }
  console.log("  ---");
  console.log(`  Identity:      ${identityId}`);
  console.log(`  Bond:          ${bondId}`);
  console.log(`  Action:        ${actionId}`);

  if (rb.released_exposure_cents !== undefined) {
    console.log(`  Released:      ${rb.released_exposure_cents} cents`);
  }
  if (rb.slashed_cents_delta !== undefined) {
    console.log(`  Slashed:       ${rb.slashed_cents_delta} cents`);
  }
  if (rb.status !== undefined) {
    console.log(`  Bond status:   ${rb.status}`);
  }

  console.log("========================================");

  if (!verified || !serverAccepted) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
