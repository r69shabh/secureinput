# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Use GitHub's private vulnerability reporting:

<https://github.com/r69shabh/secureinput/security/advisories/new>

Include:

- A short description of the issue and its impact
- A reproduction against the latest `main`
- The affected version or commit
- Any suggested fix or mitigation

You should get an acknowledgement within a few days. Please give us a reasonable window to fix the issue before public disclosure.

## Scope

SecureInput is a local desktop tool. The security boundary is described in the README and [PLAN.md](PLAN.md). In scope:

- Bypassing loopback-only binding, Host checking, same-origin checks, CSRF protection, or pairing authentication
- Reading a secret without the user submitting it, or returning a secret to an agent while return mode is disabled
- Escaping the allowed roots through path traversal, symlinks, or `.env` file handling
- Command injection or secret exposure through argv, stdin, environment, logs, audit records, SSE, or API responses
- Redaction failures that expose a submitted secret in command output
- Denial of service that locks the user out of the local UI

Out of scope:

- An attacker who already runs code as the same OS user, has root, controls the browser, or has a keylogger
- A command the user explicitly approved exfiltrating the secret
- Secrets already present in the user's environment, shell history, or `.env` files
- Unencrypted storage: SecureInput does not claim to encrypt `.env` files or the config directory
- Self-XSS or social engineering of the person approving the request
- Vulnerabilities in third-party dependencies that do not affect SecureInput's behavior (please report those upstream)

## Design notes for reviewers

- The daemon listens on `127.0.0.1` only.
- The browser is paired with a 256-bit token, exchanged for an HMAC-signed, HttpOnly, `SameSite=Strict` cookie.
- State-changing browser calls require an exact Origin match and a custom CSRF header.
- MCP calls require a 256-bit bearer token stored in a `0600` config file.
- Requests are one-time, TTL-bound, rate-limited, and capped.
- Secrets are kept in memory, delivered, then removed. They are never logged.
- Command execution uses `shell: false`; secret values are rejected in argv.
- Env writes are atomic, `0600`, symlink-safe, and restricted to `.env*` files inside allowed roots.
- Output is redacted and size-capped; audit records contain metadata only.
- Return mode is disabled unless the user starts the daemon with `--allow-return`.

## Supported versions

The latest release on `main` is supported. This project is pre-1.0; security fixes may land directly on `main`.
