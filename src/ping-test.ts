/**
 * ping-test.ts
 *
 * Proves that this project can call the AgentGate REST API.
 * Generates an Ed25519 keypair, registers an identity, and prints the response.
 *
 * Usage: npx tsx src/ping-test.ts
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
// Main
// ---------------------------------------------------------------------------

const BASE_URL = "http://127.0.0.1:3000";
const API_KEY = process.env.AGENTGATE_REST_KEY;

async function main() {
  if (!API_KEY) {
    throw new Error("AGENTGATE_REST_KEY is not set in .env");
  }

  // 1. Generate a fresh Ed25519 keypair
  const keys = generateKeypair();
  console.log("Generated Ed25519 keypair");
  console.log("  publicKey:", keys.publicKey);

  // 2. POST /v1/identities to register the identity
  //    Per AgentGate source, this endpoint requires an x-nonce header.
  const body = { publicKey: keys.publicKey };
  const nonce = randomUUID();

  const response = await fetch(new URL("/v1/identities", BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nonce": nonce,
      "x-agentgate-key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  // 3. Print the response
  console.log("\nPOST /v1/identities");
  console.log("  status:", response.status, response.statusText);

  const responseBody = await response.json();
  console.log("  response:", JSON.stringify(responseBody, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
