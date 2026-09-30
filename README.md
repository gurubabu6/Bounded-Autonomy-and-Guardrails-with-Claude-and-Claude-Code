# Enterprise Multi-Agent Code Review Orchestrator

A multi-agent code review system built with the Claude Agent SDK. An orchestrator fetches a GitHub pull request through MCP, spawns three specialized subagents, and aggregates their findings into a Zod-validated report in JSON, Markdown and HTML.

## Architecture

- **Orchestrator** (`src/orchestrator.ts`): calls `query()` with the GitHub and ESLint MCP servers, the `Task` tool, and three registered subagents. Structured output uses a JSON schema generated from Zod. The result is validated with `safeParse`, and the summary is computed from the actual findings.
- **code-quality-analyzer**: security, performance and maintainability. Invokes the `javascript-best-practices`, `security-analysis` and `typescript-patterns` skills (`.claude/skills/`).
- **test-coverage-analyzer**: finds untested functions and edge cases, estimates coverage, and suggests specific tests.
- **refactoring-suggester**: modernization, extract-function candidates, dead code, with before/after code.
- **Resilience**: `withRetry` (exponential backoff plus jitter), `withTimeout` (`Promise.race`), and a sliding 60-second-window `RateLimiter`, all used by the orchestrator.
- **Guardrails**: the review is read-only (`Bash`, `Write` and `Edit` are disallowed), and each agent gets only the tools it needs.

## Setup

Run `npm install`, then `cp .env.example .env` and set these in `.env`:

- `ANTHROPIC_MODEL=claude-sonnet-4-5-20250929`
- `PROJECT_ROOT=/absolute/path/to/project/starter`
- `GITHUB_TOKEN=<your GitHub token>` (scopes: repo, read:org)

`ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` come from the environment (Vocareum), or set your own key in `.env`. Never commit `.env`.

## Usage

Run `npm run build`, `npm test`, then `npm run dev -- <owner> <repo> <pr-number>`.
Reports are written to `reports/<owner>_<repo>_<pr>.json|md|html`.

## Submitted reports

| PR | Title | Score |
|----|-------|-------|
| #1 | add clean code fixture | 89/100 |
| #2 | Add search functionality for todos | 42/100 |
| #3 | Add premium subscription features | 27/100 |

**Note on the repository:** the assignment names `airaamane/simple-todo-app`, but that repository and its pull requests returned HTTP 404 (verified with the GitHub API, with and without an authenticated token). The reports were generated from `danielguerra1/simple-todo-app`, whose PRs #1-#3 have the same titles and states. `octocat/Hello-World` PR #1 was used as the integration test.

## Tests

`tests/schemas.test.ts` covers valid, invalid and edge-case data and the JSON schema export. `tests/orchestrator.test.ts` covers utilities and the orchestrator configuration.
