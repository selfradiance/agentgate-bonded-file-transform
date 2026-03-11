# Agent Coding Conventions — agent-001-file-transform

## Files That Must Never Be Committed

The following files are private and must never be committed to the repository:

- `AGENT_001_PROJECT_CONTEXT.md` — Private project context file for Claude sessions
- `process-template*.md` — Development process templates (any version)
- `agent-identity*.json` — Agent identity key files (contain private keys)
- `.env` — Environment variables (may contain secrets)

These are all listed in `.gitignore`. If you see any of them in `git status`, do not stage or commit them.
