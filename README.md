# Agent 001: Bonded File Transform

A bonded file-transform agent governed by AgentGate's bond-and-slash model. The agent accepts a task contract (JSON), executes a CSV-to-JSON transformation, verifies the result against a SHA-256 hash, and resolves through AgentGate. Pass = bond released. Fail = bond slashed.

## Why This Exists

AI agents today can fail silently, hallucinate outputs, or produce garbage — and nothing happens. There's no cost to doing a bad job. Agent 001 proves a different model: the agent posts collateral before it acts, the result is verified deterministically, and the bond is settled based on the outcome.

This is the first agent in the AgentGate ecosystem. It proves the simplest verification regime: machine checks machine.

## How It Relates to AgentGate

[AgentGate](https://github.com/selfradiance/agentgate) is the enforcement substrate. Agent 001 calls AgentGate's API to register an identity, lock a bond, execute a bonded action, and resolve the outcome. AgentGate handles all bonding, signing, and settlement logic. Agent 001 handles the transformation and verification.

AgentGate must be running for Agent 001 to work.

## What's Implemented

- CLI that accepts a JSON task contract specifying input file, output file, bond amount, TTL, and expected output hash
- CSV-to-JSON transformation with allowed-directory restriction and symlink rejection
- SHA-256 hash verification — deterministic pass/fail
- Full AgentGate lifecycle: identity → bond → execute → resolve
- Ed25519 signed requests matching AgentGate's format
- Path traversal protection (allowlist-based, not blocklist)
- Quoted-field detection in CSV (rejects instead of silently corrupting)
- CLI verifies server-side resolution result, not just local hash
- GitHub Actions CI

## Quick Start

```bash
# 1. Start AgentGate
cd ~/Desktop/projects/agentgate && npm run restart

# 2. Run Agent 001
cd ~/Desktop/projects/agent-001-file-transform
cp .env.example .env  # add your AGENTGATE_REST_KEY
npm install
npx tsx src/cli.ts examples/sample-contract.json
```

## Example

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

The agent reads the contract, posts a bond on AgentGate, transforms the CSV to JSON, computes the SHA-256 hash of the output, compares it to the expected hash, and resolves the bond accordingly.

## Scope / Non-Goals

- CLI only — no web server, no API
- CSV-to-JSON only — no other transform types
- Local files only — no uploads or downloads
- New identity every run — no persistence across invocations
- No automated integration tests against live AgentGate (manual verification only)

## Tests

60 tests across 3 files covering transformation, verification, contract validation, path traversal attacks, adversarial edge cases (empty files, malformed CSV, garbage contracts, unicode), and client signing logic.

```bash
npm test
```

## Related Projects

- [AgentGate](https://github.com/selfradiance/agentgate) — the core execution engine
- [Agent 002: File Guardian](https://github.com/selfradiance/agentgate-bonded-file-guardian) — command-based verification
- [Agent 003: Email Rewriter](https://github.com/selfradiance/agentgate-bonded-email-rewriter) — human judgment in the loop

## Status

Complete — v0.1.1 shipped. Triple-audited (Claude Code 8-round + Codex cold-eyes + adversarial edge cases). 60 tests.

## License

MIT
