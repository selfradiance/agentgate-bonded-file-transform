import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVerify } from "node:crypto";
import {
  generateKeypair,
  buildSignedMessage,
  signRequest,
  AgentGateClient,
} from "../src/agentgate-client";

// ---------------------------------------------------------------------------
// Signing logic tests
// ---------------------------------------------------------------------------

describe("signing logic", () => {
  const keys = generateKeypair();

  it("generateKeypair returns base64 public and private keys", () => {
    expect(keys.publicKey).toBeTruthy();
    expect(keys.privateKey).toBeTruthy();
    // Ed25519 public key is 32 bytes = 44 base64 chars (with possible padding)
    const pubBytes = Buffer.from(keys.publicKey, "base64");
    expect(pubBytes.length).toBe(32);
    const privBytes = Buffer.from(keys.privateKey, "base64");
    expect(privBytes.length).toBe(32);
  });

  it("buildSignedMessage produces deterministic output", () => {
    const msg1 = buildSignedMessage("nonce1", "POST", "/v1/test", "12345", { foo: "bar" });
    const msg2 = buildSignedMessage("nonce1", "POST", "/v1/test", "12345", { foo: "bar" });
    expect(msg1.equals(msg2)).toBe(true);
  });

  it("buildSignedMessage changes with different nonce", () => {
    const msg1 = buildSignedMessage("nonce1", "POST", "/v1/test", "12345", { foo: "bar" });
    const msg2 = buildSignedMessage("nonce2", "POST", "/v1/test", "12345", { foo: "bar" });
    expect(msg1.equals(msg2)).toBe(false);
  });

  it("buildSignedMessage includes method and path", () => {
    const msg1 = buildSignedMessage("n", "POST", "/v1/a", "t", {});
    const msg2 = buildSignedMessage("n", "GET", "/v1/b", "t", {});
    expect(msg1.equals(msg2)).toBe(false);
  });

  it("signRequest returns a valid base64 signature", () => {
    const sig = signRequest(keys.publicKey, keys.privateKey, "nonce", "POST", "/v1/test", "12345", { a: 1 });
    expect(sig).toBeTruthy();
    // Should be valid base64
    const sigBytes = Buffer.from(sig, "base64");
    // Ed25519 signatures are 64 bytes
    expect(sigBytes.length).toBe(64);
  });

  it("signRequest produces different signatures for different bodies", () => {
    const sig1 = signRequest(keys.publicKey, keys.privateKey, "n", "POST", "/p", "t", { a: 1 });
    const sig2 = signRequest(keys.publicKey, keys.privateKey, "n", "POST", "/p", "t", { a: 2 });
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// Signed header generation tests
// ---------------------------------------------------------------------------

describe("signed header generation", () => {
  let client: AgentGateClient;
  let keys: { publicKey: string; privateKey: string };
  let capturedHeaders: Record<string, string>;

  beforeEach(() => {
    keys = generateKeypair();
    client = new AgentGateClient("http://localhost:9999", "test-api-key");
    capturedHeaders = {};

    // Mock fetch to capture headers
    vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signedPost includes all required security headers", async () => {
    await client.signedPost("/v1/test", { data: 1 }, keys.publicKey, keys.privateKey);

    expect(capturedHeaders["content-type"]).toBe("application/json");
    expect(capturedHeaders["x-nonce"]).toBeTruthy();
    expect(capturedHeaders["x-agentgate-key"]).toBe("test-api-key");
    expect(capturedHeaders["x-agentgate-timestamp"]).toBeTruthy();
    expect(capturedHeaders["x-agentgate-signature"]).toBeTruthy();
  });

  it("signedPost generates unique nonce per request", async () => {
    await client.signedPost("/v1/test", {}, keys.publicKey, keys.privateKey);
    const nonce1 = capturedHeaders["x-nonce"];

    await client.signedPost("/v1/test", {}, keys.publicKey, keys.privateKey);
    const nonce2 = capturedHeaders["x-nonce"];

    expect(nonce1).not.toBe(nonce2);
  });

  it("unsignedPost includes API key but no signature", async () => {
    await client.unsignedPost("/v1/test", { data: 1 });

    expect(capturedHeaders["x-agentgate-key"]).toBe("test-api-key");
    expect(capturedHeaders["x-nonce"]).toBeTruthy();
    expect(capturedHeaders["x-agentgate-signature"]).toBeUndefined();
    expect(capturedHeaders["x-agentgate-timestamp"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HTTP error handling tests
// ---------------------------------------------------------------------------

describe("HTTP error handling", () => {
  let client: AgentGateClient;
  let keys: { publicKey: string; privateKey: string };

  beforeEach(() => {
    keys = generateKeypair();
    client = new AgentGateClient("http://localhost:9999", "test-api-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles JSON error response from server", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error: "unauthorized", message: "bad key" }), {
        status: 401,
        statusText: "Unauthorized",
      });
    });

    const result = await client.signedPost("/v1/test", {}, keys.publicKey, keys.privateKey);
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("unauthorized");
  });

  it("handles non-JSON error response (HTML error page)", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
      });
    });

    const result = await client.signedPost("/v1/test", {}, keys.publicKey, keys.privateKey);
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("UNPARSEABLE_RESPONSE");
    expect(result.body.message).toBe("<html>502 Bad Gateway</html>");
  });

  it("handles empty response body", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response("", { status: 500, statusText: "Internal Server Error" });
    });

    const result = await client.unsignedPost("/v1/test", {});
    expect(result.status).toBe(500);
    expect(result.body.error).toBe("UNPARSEABLE_RESPONSE");
    expect(result.body.message).toBe("(empty)");
  });

  it("createIdentity throws on missing identityId", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400, statusText: "Bad Request" });
    });

    await expect(client.createIdentity(keys.publicKey, keys.privateKey)).rejects.toThrow("No identityId returned");
  });

  it("lockBond throws on missing bondId", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400, statusText: "Bad Request" });
    });

    await expect(client.lockBond("id", 100, 300, "test", keys.publicKey, keys.privateKey)).rejects.toThrow(
      "No bondId returned",
    );
  });

  it("executeAction throws on missing actionId", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400, statusText: "Bad Request" });
    });

    await expect(
      client.executeAction("id", "bond", "file-transform", {}, 50, keys.publicKey, keys.privateKey),
    ).rejects.toThrow("No actionId returned");
  });
});

// ---------------------------------------------------------------------------
// Resolve outcome reporting tests
// ---------------------------------------------------------------------------

describe("resolve outcome reporting", () => {
  let client: AgentGateClient;
  let keys: { publicKey: string; privateKey: string };

  beforeEach(() => {
    keys = generateKeypair();
    client = new AgentGateClient("http://localhost:9999", "test-api-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveAction returns server response on success", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(
        JSON.stringify({ released_exposure_cents: 83, status: "settled" }),
        { status: 200, statusText: "OK" },
      );
    });

    const result = await client.resolveAction("action-123", "success", keys.publicKey, keys.privateKey);
    expect(result.status).toBe(200);
    expect(result.body.released_exposure_cents).toBe(83);
    expect(result.body.status).toBe("settled");
  });

  it("resolveAction returns server error on rejection", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(
        JSON.stringify({ error: "action_already_resolved" }),
        { status: 409, statusText: "Conflict" },
      );
    });

    const result = await client.resolveAction("action-123", "success", keys.publicKey, keys.privateKey);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("action_already_resolved");
  });

  it("resolveAction sends correct path with action ID", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", async (url: URL | string) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" });
    });

    await client.resolveAction("abc-123", "failed", keys.publicKey, keys.privateKey);
    expect(capturedUrl).toContain("/v1/actions/abc-123/resolve");
  });

  it("resolveAction sends correct outcome in body", async () => {
    let capturedBody = "";
    vi.stubGlobal("fetch", async (_url: URL | string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" });
    });

    await client.resolveAction("id", "failed", keys.publicKey, keys.privateKey);
    expect(JSON.parse(capturedBody)).toEqual({ outcome: "failed" });
  });
});
