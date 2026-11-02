# SecureInput — implementation plan

## Problem

Coding agents constantly need secrets: API keys, passwords, tokens. Today the user either
pastes the secret into the chat (where it becomes part of the model context and transcript)
or the agent prints a command that the user must run in a terminal. Both are error-prone and
leak the secret to places it does not need to be.

SecureInput is a local-first MCP server with a tiny browser UI. The agent asks for a secret,
the user types it into a local page, and the server delivers it directly to the destination
the user approved: a command's stdin/environment, or an environment file. The agent only
receives a status and redacted output.

## Goals

- An MCP tool any coding agent can call: `request_secret`.
- A friendly, shadcn/ui-only input page served on loopback.
- Secret delivery without returning the value to the agent by default.
- Two main sinks: run a non-interactive command, or write an env file atomically.
- Explicit user consent with clear request provenance, destination, and risk.
- Strong local security defaults: no remote bind, pairing token, CSRF/DNS-rebinding guards,
  one-time requests, expiry, output redaction, no secret logging.
- A single `main` branch, tests, CI, and an SEO-oriented README.

## Non-goals

- Multi-user or remote hosting.
- Protecting against root, same-user malware, a compromised browser, or keyloggers.
- Storing secrets for later reuse (no vault). `write_env` is the only persistence.
- Interactive/TTY programs. Commands must be non-interactive.
- Guaranteeing redaction of arbitrary transformations of a secret.

## Architecture

```
coding agent
    │ stdio MCP (npx secureinput mcp)
    ▼
stdio bridge ── HTTP ──► local daemon (127.0.0.1)
                           ├── REST + SSE ──► browser UI (shadcn)
                           ├── Streamable HTTP MCP (/mcp)
                           ├── command executor (no shell)
                           └── atomic env writer
```

One daemon is shared by all agents on the machine. The stdio bridge auto-starts it and then
forwards `request_secret` calls over authenticated loopback HTTP. The daemon is also a
Streamable HTTP MCP endpoint for clients that support that transport.

## Packages and layout

Single npm package, one binary `secureinput`, Vite-built web UI served by the Node daemon.

- `src/shared` — zod schemas, types, validation, redaction, formatting (browser-safe).
- `src/server` — Express app, auth, request service, delivery, risk, audit, MCP transports.
- `src/cli` — `serve`, `mcp`, `pair`, `status`, `stop`, `doctor`.
- `src/mcp` — stdio MCP bridge.
- `src/web` — React + Vite + Tailwind + shadcn/ui.
- `test` — node:test unit and integration tests.

## Request lifecycle

`pending → executing → completed | failed`, or `denied | expired | canceled`.

1. Agent calls `request_secret` with fields, purpose, and a delivery plan.
2. Server validates the plan against policy, computes a risk summary, and creates a request
   with a hard TTL (default 5 min, max 15 min).
3. Browser receives the request over SSE and shows it.
4. User reviews provenance and destination, fills fields, and submits or denies.
5. Server validates values (RE2-safe patterns, length caps), claims the request atomically,
   runs the delivery, redacts output, clears values, stores only the sanitized result.
6. Agent's blocking tool call (or a later `check_secret_request` poll) receives the result.
   With `return` mode (off by default), values are returned only after an explicit warning.

## MCP surface

- `request_secret` — create and optionally wait (default 30s, max 240s).
- `check_secret_request` — long-poll an existing request (max 45s).
- `cancel_secret_request` — cancel a pending request.
- `secureinput_status` — daemon health and policy summary.

Delivery plans:

- `execute`: `{ mode, command, args?, cwd?, stdin?, env?, timeoutSeconds? }`
  - No shell. `command` and `args` cannot contain secret placeholders in argv, so secrets
    never appear in the process list.
  - Secret fields may be referenced in `stdin` and `env` values as `{{fieldId}}`.
  - Non-sensitive text fields may be used in `args` for things like usernames.
- `write_env`: `{ mode, path, mapping, overwrite? }`
  - `mapping` is `{ fieldId: "ENV_NAME" }`.
  - Path must be inside an allowed root and be an env file (`.env`, `.env.local`, ...).
  - Existing keys require `overwrite: true` and an extra UI confirmation.
  - Atomic write, mode 0600, comments and line endings preserved.
- `return`: `{ mode }` — opt-in via `--allow-return`; big warning in UI.

## Security model

### Trust boundaries

- Browser user: trusted to make the approval decision.
- Coding agent / LLM: semi-trusted; can be prompt-injected by repository content. It must not
  receive secret values unless `return` is explicitly enabled.
- Remote websites in the user's browser: untrusted; could attempt CSRF, clickjacking, or DNS
  rebinding against localhost.
- Local processes running as the same user: outside the boundary. They can read the config
  and token; we do not pretend to sandbox same-user malware.

### Controls

- Bind only to `127.0.0.1`; reject non-loopback Host headers.
- 256-bit random MCP token and pairing token in `~/.secureinput/config.json` (0600).
- Browser pairing token exchanged for an HttpOnly, SameSite=Strict, signed session cookie.
- State-changing browser API requires an Origin match and a custom CSRF header.
- No CORS headers. Strict CSP, `frame-ancestors 'none'`, no-store on API/index.
- One-time request claim, TTL, max pending/rate limits.
- Constant-time token comparison; pairing rate limit.
- Field values capped (8 KiB each, 32 KiB total), strings length-capped and control-stripped.
- Agent regex patterns compiled with RE2 (linear time, no ReDoS).
- No secret in URLs, logs, audit records, errors, or (by default) tool results.
- Output is ANSI-stripped, size-capped, and redacts raw/URL/JSON/base64 forms of every secret
  plus common token patterns.
- Command runs with `shell: false`; timeout kills the process group; stdin/env only.
- Env writes are atomic, 0600, reject symlinks, and stay inside allowed roots.
- High-risk requests (network clients, shells/interpreters, return mode, env overwrite) need
  an extra confirmation checkbox.
- Audit log records metadata and outcomes, never values or raw output.

### Documented limitations

- A command the user approves can exfiltrate the secret; user review is the final control.
- Environment variables are visible to same-user processes on some systems; stdin is safer.
- Redaction is best-effort for transformed secrets (e.g. hashed or split output).
- Pending requests and secrets live in memory; a daemon restart loses them.
- TTY-only login flows are unsupported; use the tool's non-interactive token mode.

## Edge cases handled

- Double submit, concurrent tabs, submit after expiry, deny while executing.
- Agent disconnects; request remains until TTL. Completed results are kept briefly for polls.
- Command not found, non-zero exit, timeout, signal, huge/binary/ANSI output, cwd missing.
- Secrets containing quotes, newlines, `$`, `#`, backslashes, Unicode.
- Env files with CRLF, comments, `export`, duplicate keys, quoted values, missing trailing
  newline; overwriting an existing key; symlink escaping an allowed root.
- Field validation errors and malformed agent input never echo secret values.
- Request spam, token brute force, invalid Origin, invalid Host, cross-site form posts.
- Browser reconnect/tab duplication; SSE state resync.
- Prototype-pollution keys (`__proto__`, `constructor`) in env mappings.

## UI

- Pairing screen if the session is missing/expired.
- Pending list + detail inspector, mobile responsive.
- Provenance ("reported by <client> in <cwd>"), agent-supplied text visibly marked.
- Delivery summary (command and args, env keys, file path), risk alert, countdown.
- Masked inputs with reveal toggle, validation, paste support, autocomplete off.
- Submit/deny with confirmation for destructive/high-risk actions.
- Execution result with redacted stdout/stderr.
- History of metadata only.
- Connection indicator and title badge for pending requests.
- shadcn components only; system fonts; no external assets.

## SEO README

Title and headings target: secure input for AI coding agents, MCP secret server, API key input
for Claude Code/Cursor/Codex, stop pasting secrets in chat, localhost secret manager, MCP
environment variable tool. Include quick starts for popular clients, comparison table, FAQ,
security model, tool reference, and copy-paste config snippets.

## Verification

- Typecheck server and web.
- Unit tests: validation, template resolution, argv secret rejection, redaction, env updater,
  path policy, risk classification, auth helpers.
- Integration tests: daemon boot on ephemeral port, pairing, create request, SSE, submit,
  execute with stdin, redacted output, one-time claim, expiry, deny, env write, auth/Origin/
  Host rejection, MCP streamable HTTP tool call, stdio bridge smoke test.
- Build web UI and run a manual smoke test against the built daemon.
- CI on Node 22.

## Milestones

1. Repo scaffold, plan, license, CI skeleton.
2. Shared schemas and security utilities with tests.
3. Daemon: auth, store, request service, delivery, SSE/REST.
4. MCP stdio bridge + HTTP MCP.
5. shadcn UI and pairing flow.
6. End-to-end tests, docs, README.
7. Push `main` to GitHub.
