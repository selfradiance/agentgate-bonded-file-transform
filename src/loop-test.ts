/**
 * loop-test.ts
 *
 * Full AgentGate loop: create identity → lock bond → execute action → resolve.
 * Proves Agent 001 can perform the complete bonded-action lifecycle.
 *
 * Usage: npx tsx src/loop-test.ts
 */

import "dotenv/config";
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";

// ---------------------------------------------------------------------------
// Key helpers (replicated from AgentGate signing.ts)
// ---------------------------------------------------------------------------

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBase64(value: string): string {
  return Buffer.from(value, "base64url").toString("base64");
}

// ---------------------------------------------------------------------------
// Signing helpers (replicated from AgentGate signing.ts)
// ---------------------------------------------------------------------------

function buildSignedMessage(timestamp: string, body: unknown): Buffer {
  return createHash("sha256").update(`${timestamp}${JSON.stringify(body)}`).digest();
}

function signRequest(
  publicKeyBase64: string,
  privateKeyBase64: string,
  timestamp: string,
  body: unknown,
): string {
  const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
  const privateKeyBytes = Buffer.from(privateKeyBase64, "base64");

  const privateKey = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: toBase64Url(publicKeyBytes),
      d: toBase64Url(privateKeyBytes),
    },
    format: "jwk",
  });

  const signature = sign(null, buildSignedMessage(timestamp, body), privateKey);
  return signature.toString("base64");
}

// ---------------------------------------------------------------------------
// Keypair generation (replicated from AgentGate agent-adapter.ts)
// ---------------------------------------------------------------------------

function generateKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });

  if (!publicJwk.x || !privateJwk.d) {
    throw new Error("Failed to export Ed25519 keypair as JWK");
  }

  return {
    publicKey: base64UrlToBase64(publicJwk.x),
    privateKey: base64UrlToBase64(privateJwk.d),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://127.0.0.1:3000";
const API_KEY = process.env.AGENTGATE_REST_KEY;

async function unsignedPost(path: string, body: unknown) {
  const response = await fetch(new URL(path, BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nonce": randomUUID(),
      "x-agentgate-key": API_KEY!,
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.json();
  return { status: response.status, statusText: response.statusText, body: responseBody };
}

async function signedPost(
  path: string,
  body: unknown,
  publicKey: string,
  privateKey: string,
) {
  const timestamp = Date.now().toString();
  const signature = signRequest(publicKey, privateKey, timestamp, body);

  const response = await fetch(new URL(path, BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nonce": randomUUID(),
      "x-agentgate-key": API_KEY!,
      "x-agentgate-timestamp": timestamp,
      "x-agentgate-signature": signature,
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.json();
  return { status: response.status, statusText: response.statusText, body: responseBody };
}

function printStep(label: string, result: { status: number; statusText: string; body: unknown }) {
  console.log(`\n=== ${label} ===`);
  console.log(`  status: ${result.status} ${result.statusText}`);
  console.log(`  response: ${JSON.stringify(result.body, null, 2)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    throw new Error("AGENTGATE_REST_KEY is not set in .env");
  }

  // 1. Generate keypair and create identity
  const keys = generateKeypair();
  console.log("Generated Ed25519 keypair");
  console.log("  publicKey:", keys.publicKey);

  const identityResult = await unsignedPost("/v1/identities", {
    publicKey: keys.publicKey,
  });
  printStep("Step 1: Create Identity", identityResult);

  const identityId =
    (identityResult.body as Record<string, unknown>).identityId ??
    (identityResult.body as Record<string, unknown>).id;
  if (!identityId) {
    throw new Error("No identityId returned from identity creation");
  }
  console.log(`  identityId: ${identityId}`);

  // 2. Lock a bond (signed)
  const lockResult = await signedPost(
    "/v1/bonds/lock",
    {
      identityId,
      amountCents: 100,
      currency: "USD",
      ttlSeconds: 300,
      reason: "loop test",
    },
    keys.publicKey,
    keys.privateKey,
  );
  printStep("Step 2: Lock Bond", lockResult);

  const bondId =
    (lockResult.body as Record<string, unknown>).bondId ??
    (lockResult.body as Record<string, unknown>).bond_id;
  if (!bondId) {
    throw new Error("No bondId returned from lock bond");
  }

  // 3. Execute a bonded action (signed)
  const executeResult = await signedPost(
    "/v1/actions/execute",
    {
      identityId,
      actionType: "file-transform",
      payload: { test: true },
      bondId,
      exposure_cents: 50,
    },
    keys.publicKey,
    keys.privateKey,
  );
  printStep("Step 3: Execute Bonded Action", executeResult);

  const actionId =
    (executeResult.body as Record<string, unknown>).actionId ??
    (executeResult.body as Record<string, unknown>).action_id;
  if (!actionId) {
    throw new Error("No actionId returned from execute action");
  }

  // 4. Resolve the action as success (signed)
  const resolveResult = await signedPost(
    `/v1/actions/${actionId}/resolve`,
    { outcome: "success" },
    keys.publicKey,
    keys.privateKey,
  );
  printStep("Step 4: Resolve Action", resolveResult);

  console.log("\n=== Full loop complete ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
