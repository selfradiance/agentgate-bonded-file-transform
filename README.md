# Agent 001: Bonded File Transform

A bonded file-transform agent. It accepts a task contract (JSON), executes a file transformation, verifies the result deterministically, and resolves through [AgentGate](https://github.com/selfradiance/agentgate). If the output is correct, the bond is released. If not, the bond is slashed. The agent has skin in the game.

## How It Works

1. Read and validate the task contract (Zod schema with strict field validation)
2. Create an Ed25519 identity with AgentGate (signed with proof-of-possession)
3. Lock a bond (agent puts up collateral)
4. Register a bonded action (signed with nonce, method, path, timestamp, body)
5. Run the transform (CSV to JSON)
6. Verify the output against the expected SHA-256 hash
7. Resolve the action as `success` or `failed` — bond released or slashed accordingly

All state-changing requests are signed using Ed25519 signatures over `sha256(nonce + method + path + timestamp + JSON.stringify(body))`, matching AgentGate's authentication protocol.

## Task Contract

```json
{
  "task": "file-transform",
  "transform_type": "csv-to-json",
  "input_file": "examples/sample-input.csv",
  "output_file": "examples/sample-output.json",
  "bond_amount_cents": 100,
  "ttl_seconds": 300,
  "expected_output_hash": "sha256:2d02509c..."
}
```

| Field | Description |
|---|---|
| `task` | Must be `"file-transform"` |
| `transform_type` | Must be `"csv-to-json"` (only supported type) |
| `input_file` | Path to the input CSV file (non-empty, path-traversal protected) |
| `output_file` | Path where the JSON output will be written (non-empty, path-traversal protected) |
| `bond_amount_cents` | Bond collateral in cents (positive integer) |
| `ttl_seconds` | Bond time-to-live in seconds (positive integer) |
| `expected_output_hash` | SHA-256 hash of the expected output (`sha256:` prefix + exactly 64 lowercase hex chars) |

## Quick Start

**Prerequisites:** Node.js 20+, [AgentGate](https://github.com/selfradiance/agentgate) running locally on port 3000.

```bash
# Clone and install
git clone https://github.com/selfradiance/agent-001-file-transform.git
cd agent-001-file-transform
npm install

# Configure
cp .env.example .env
# Edit .env and set AGENTGATE_REST_KEY

# Run the agent
npm run agent -- examples/sample-contract.json

# Run tests
npm test
```

## Tests

60 tests across 3 test files:

- **test/agent.test.ts** — core transform + verify tests, path traversal checks, contract validation (14 tests)
- **test/edge-cases.test.ts** — adversarial inputs: empty files, malformed CSV, CRLF line endings, unicode, wide CSVs, garbage contracts, path traversal attacks, hash edge cases (27 tests)
- **test/client.test.ts** — signing logic, signed header generation, HTTP error handling, resolve outcome reporting (19 tests)

```bash
npm test
```

## Security

- **Ed25519 signed requests** — all state-changing API calls include nonce, method, path, timestamp, and body in the signed message
- **Proof-of-possession** — identity registration proves the caller owns the private key
- **Path traversal protection** — file operations are restricted to a configurable allowed directory (defaults to `cwd()`); symlinks are detected and rejected; paths outside the allowed directory are blocked
- **Contract validation** — Zod schema enforces types, required fields, positive integers, non-empty strings, and strict `sha256:` hash format (exactly 64 lowercase hex characters)
- **CSV quoted-field rejection** — CSV input containing quoted fields is rejected with a clear error instead of silently producing wrong output
- **Resolve verification** — CLI checks the actual AgentGate API response to confirm resolution was accepted, not just local hash verification
- **Graceful error handling** — response bodies are read as text first, then parsed as JSON, preventing consumed-body errors from hiding server error messages

## CSV Parser Limitations

The CSV parser uses simple comma-splitting. It does **not** handle quoted fields, embedded commas, or newlines inside quotes. As of v0.1.1, CSV input containing quoted fields is detected and rejected with a clear error rather than silently producing wrong output. A production agent would use a proper CSV parsing library.

## Project Structure

```
src/
  cli.ts              — main entry point (contract → AgentGate lifecycle)
  agentgate-client.ts  — HTTP client with Ed25519 signing
  contract.ts          — Zod schema for task contracts
  transform.ts         — CSV-to-JSON transform with path protection
  verify.ts            — SHA-256 hash computation and verification
scripts/
  ping-test.ts         — connectivity test (register identity)
  loop-test.ts         — full AgentGate lifecycle test
  transform-test.ts    — manual transform test
  verify-test.ts       — manual hash verification test
test/
  agent.test.ts        — core tests (14)
  edge-cases.test.ts   — adversarial tests (27)
  client.test.ts       — client + signing tests (19)
examples/
  sample-input.csv     — demo input
  sample-contract.json — demo task contract
```

## Built on AgentGate

This is the first agent in the single-task sandboxed agent pattern. Each agent locks a bond, performs one deterministic task, and resolves through [AgentGate](https://github.com/selfradiance/agentgate) — creating cryptographic accountability for autonomous work.

## License

MIT
