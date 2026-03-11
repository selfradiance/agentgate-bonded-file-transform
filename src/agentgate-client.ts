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

export function generateKeypair(): { publicKey: string; privateKey: string } {
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

export interface ApiResponse {
  status: number;
  statusText: string;
  body: Record<string, unknown>;
}

export function printStep(label: string, result: ApiResponse): void {
  console.log(`\n=== ${label} ===`);
  console.log(`  status: ${result.status} ${result.statusText}`);
  console.log(`  response: ${JSON.stringify(result.body, null, 2)}`);
}

export class AgentGateClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async unsignedPost(path: string, body: unknown): Promise<ApiResponse> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nonce": randomUUID(),
        "x-agentgate-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    const responseBody = await response.json();
    return { status: response.status, statusText: response.statusText, body: responseBody as Record<string, unknown> };
  }

  async signedPost(
    path: string,
    body: unknown,
    publicKey: string,
    privateKey: string,
  ): Promise<ApiResponse> {
    const timestamp = Date.now().toString();
    const signature = signRequest(publicKey, privateKey, timestamp, body);

    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nonce": randomUUID(),
        "x-agentgate-key": this.apiKey,
        "x-agentgate-timestamp": timestamp,
        "x-agentgate-signature": signature,
      },
      body: JSON.stringify(body),
    });

    const responseBody = await response.json();
    return { status: response.status, statusText: response.statusText, body: responseBody as Record<string, unknown> };
  }

  async createIdentity(publicKey: string): Promise<{ identityId: string; raw: ApiResponse }> {
    const result = await this.unsignedPost("/v1/identities", { publicKey });

    const identityId = result.body.identityId ?? result.body.id;
    if (typeof identityId !== "string") {
      throw new Error(`No identityId returned (status ${result.status}): ${JSON.stringify(result.body)}`);
    }

    return { identityId, raw: result };
  }

  async lockBond(
    identityId: string,
    amountCents: number,
    ttlSeconds: number,
    reason: string,
    publicKey: string,
    privateKey: string,
  ): Promise<{ bondId: string; raw: ApiResponse }> {
    const result = await this.signedPost(
      "/v1/bonds/lock",
      { identityId, amountCents, currency: "USD", ttlSeconds, reason },
      publicKey,
      privateKey,
    );

    const bondId = result.body.bondId ?? result.body.bond_id;
    if (typeof bondId !== "string") {
      throw new Error(`No bondId returned (status ${result.status}): ${JSON.stringify(result.body)}`);
    }

    return { bondId, raw: result };
  }

  async executeAction(
    identityId: string,
    bondId: string,
    actionType: string,
    payload: unknown,
    exposureCents: number,
    publicKey: string,
    privateKey: string,
  ): Promise<{ actionId: string; raw: ApiResponse }> {
    const result = await this.signedPost(
      "/v1/actions/execute",
      { identityId, actionType, payload, bondId, exposure_cents: exposureCents },
      publicKey,
      privateKey,
    );

    const actionId = result.body.actionId ?? result.body.action_id;
    if (typeof actionId !== "string") {
      throw new Error(`No actionId returned (status ${result.status}): ${JSON.stringify(result.body)}`);
    }

    return { actionId, raw: result };
  }

  async resolveAction(
    actionId: string,
    outcome: "success" | "failed" | "malicious",
    publicKey: string,
    privateKey: string,
  ): Promise<ApiResponse> {
    return this.signedPost(
      `/v1/actions/${actionId}/resolve`,
      { outcome },
      publicKey,
      privateKey,
    );
  }
}
