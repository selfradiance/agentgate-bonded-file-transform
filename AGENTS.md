# Agent Coding Conventions — agent-001-file-transform

## Files That Must Never Be Committed

The following files are private and must never be committed to the repository:

- `AGENT_001_PROJECT_CONTEXT.md` — Private project context file for Claude sessions
- `process-template*.md` — Development process templates (any version)
- `agent-identity*.json` — Agent identity key files (contain private keys)
- `.env` — Environment variables (may contain secrets)

These are all listed in `.gitignore`. If you see any of them in `git status`, do not stage or commit them.

## Change Size Targets

Keep diffs under ~100 lines per change. If a change exceeds 300 lines, stop and break it into smaller pieces before proceeding.

## Anti-Rationalization

| Excuse | Rebuttal |
|--------|----------|
| "I'll add tests later" | Tests are not optional. Write them now. |
| "It's just a prototype" | Prototypes become production. Build it right. |
| "This change is too small to break anything" | Small changes cause subtle bugs. Run the tests. |
| "I already know this works" | You don't. Verify it. |
| "Cleaning up this adjacent code will save time" | Stay in scope. File it for later. |
| "The user probably meant X" | Don't assume. Ask. |
| "Skipping the audit since it's straightforward" | Straightforward changes still need verification. |
| "I'll commit everything at the end" | Commit after each verified change. No batching. |

### Slicing Strategies

- **Vertical slice:** Implement one complete feature top to bottom (route, logic, test) before starting another.
- **Risk-first slice:** Tackle the riskiest or most uncertain piece first to surface problems early.
- **Contract-first slice:** Define the API contract or interface first, then implement behind it.
