# SecureInput

**Your agent needs the token. It doesn't need to see it.**

[![CI](https://github.com/r69shabh/secureinput/actions/workflows/ci.yml/badge.svg)](https://github.com/r69shabh/secureinput/actions/workflows/ci.yml)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.r69shabh%2Fsecureinput-2F4060)](https://registry.modelcontextprotocol.io/v0/servers?search=secureinput)
[![License: MIT](https://img.shields.io/badge/license-MIT-2F4060)](LICENSE)

SecureInput is an open-source, local-first MCP server for API keys, passwords, and tokens. When your coding agent needs a credential, you type it into a small input that appears **inside the chat**, styled like the host's own composer. The value goes straight to a local command (stdin or env) or a `.env` file. The agent only gets back `{ "ok": true, "status": "completed", "exitCode": 0 }`.

Works with Claude Code, Claude Desktop, Cursor, Codex, VS Code / GitHub Copilot, Windsurf, Cline, and any stdio MCP client. macOS and Linux, Node.js 22+.

**[Install](#install)** · **[How it works](#how-it-works)** · **[Security model](docs/security-model.md)** · **[FAQ](#faq)** · [Watch the 20-second overview](docs/media/secureinput-overview.mp4)

## Install

Pick your client. Every option runs `npx -y secureinput mcp` (Node.js 22+), which starts the shared local daemon on first use. Try it with a **fake** key first.

[![Add to Cursor](https://img.shields.io/badge/Add_to-Cursor-2F4060?logo=cursor)](https://cursor.com/en/install-mcp?name=secureinput&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNlY3VyZWlucHV0IiwibWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/Install_in-VS_Code-2F4060?logo=visualstudiocode)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522secureinput%2522%252C%2522type%2522%253A%2522stdio%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522secureinput%2522%252C%2522mcp%2522%255D%257D)
[![Download for Claude Desktop](https://img.shields.io/badge/Download_for-Claude_Desktop-2F4060?logo=anthropic)](https://github.com/r69shabh/secureinput/releases/latest)

### 1. Connect your agent

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add --scope user secureinput -- npx -y secureinput mcp
claude mcp list     # secureinput: ✔ Connected
```
</details>

<details open>
<summary><b>Claude Desktop</b>: one-file bundle, no terminal</summary>

1. Download the latest `secureinput-release-*.mcpb` from [GitHub Releases](https://github.com/r69shabh/secureinput/releases/latest). The bundle is unsigned; review the release before installing.
2. Open **Settings → Desktop app → Manage** next to Extensions (older versions: **Settings → Extensions**), then **Advanced settings → Install Extension…** and pick the file. See [Claude's guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
3. Ask Claude to save a fake key with SecureInput.

To upgrade, install the newer `.mcpb`.
</details>

<details>
<summary><b>Cursor</b>: use the button above, or <code>~/.cursor/mcp.json</code></summary>

```json
{ "mcpServers": { "secureinput": { "command": "npx", "args": ["-y", "secureinput", "mcp"] } } }
```
</details>

<details>
<summary><b>VS Code / GitHub Copilot</b>: use the button above, or <code>.vscode/mcp.json</code></summary>

```json
{ "servers": { "secureinput": { "type": "stdio", "command": "npx", "args": ["-y", "secureinput", "mcp"] } } }
```
</details>

<details>
<summary><b>Codex CLI</b></summary>

```bash
codex mcp add secureinput -- npx -y secureinput mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.secureinput]
command = "npx"
args = ["-y", "secureinput", "mcp"]
```
</details>

<details>
<summary><b>Windsurf, Cline, or any stdio client</b></summary>

```json
{ "mcpServers": { "secureinput": { "command": "npx", "args": ["-y", "secureinput", "mcp"] } } }
```
</details>

<details>
<summary><b>Global install or from source</b></summary>

```bash
npm install -g secureinput     # then use command "secureinput", args ["mcp"]
secureinput doctor             # checks Node, config and the daemon
```

From source: `git clone https://github.com/r69shabh/secureinput.git && cd secureinput && npm ci && npm run build && npm link`.

GUI apps may not see a Node version manager's PATH (fnm, nvm, volta). If `npx` isn't found, use the full path from `realpath "$(which npx)"` as the command.
</details>

### 2. Tell your agent to use it

Add this to your agent rules (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, …) so it reaches for the tool instead of asking you to paste:

```text
When you need an API key, password, or token, call the SecureInput MCP tool
request_secret. Do not ask me to paste secrets into chat. Prefer delivery
mode "execute" with the secret in stdin/env, or "write_env" for .env files.
```

## How it works

```
agent: "I need a GitHub token to create the repo."
        │  request_secret (MCP)
        ▼
  input inside the chat (MCP Apps hosts)  ─or─  paired page on 127.0.0.1
        │  encrypted to the local daemon
        ▼
  SecureInput daemon on 127.0.0.1
        ├── execute:   gh auth login --with-token   (token through stdin)
        └── write_env: .env.local                   (mode 0600)
        │
        ▼
agent: { "ok": true, "status": "completed", "exitCode": 0 }
```

### Feels native in every host

On hosts that support [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps), the input renders inline in the conversation and adopts the host's own theme, fonts, colours, corner radii, and focus ring from the design tokens the host provides. In Claude it looks like Claude's composer; in a dark-mode client it's dark. Hosts that send no tokens get a neutral light/dark fallback. Press Enter to submit; there is no extra SecureInput dialog.

Text-only clients automatically fall back to a paired page on `127.0.0.1`, which also shows the destination and a risk review before anything runs. Force it with `secureinput settings --input-mode browser`.

### What stays out of the chat

| | Pasting into chat | SecureInput |
| --- | --- | --- |
| Model context and transcript | ✗ contains the key | ✓ status only |
| Shell history / `ps` | often | ✓ never: stdin or env, no shell |
| `.env` permissions | whatever you typed | ✓ atomic write, `0600` |
| Reuse of a request | n/a | ✓ one-time, expires (5 min default) |

SecureInput keeps the value out of the MCP result, but the commands you approve, the host that renders the inline form, and anything that can read a written `.env` file are still trusted. Read the [security model](docs/security-model.md) before using real credentials.

## Features

- **One MCP tool**: `request_secret`, plus check, cancel, and status tools.
- **Local only**: binds `127.0.0.1`; pairing token, signed session cookie, Origin and CSRF checks.
- **No secret in results by default**: the agent sees status and exit code; stdout/stderr are withheld.
- **Direct execution**: no shell; secrets through stdin or env, rejected in command arguments.
- **Safe `.env` writes**: atomic replace, `0600`, comments and line endings kept, `.env` / `.env.*` only, no overwrites unless requested.
- **Encrypted inline submission**: AES-256-GCM, key wrapped with a fresh RSA-OAEP key pair held only by the daemon.
- **Allowed roots**: commands and `.env` files must sit inside your allowed folders (home by default).
- **Defense in depth**: RE2-safe patterns, size caps, ANSI stripping, output redaction, audit log without values.
- **Opt-in return mode**: for clients that truly need the value back; off by default and marked dangerous.

## Inline input details

The inline form encrypts values and a one-request capability with AES-256-GCM; a fresh RSA-OAEP-SHA-256 key pair wraps the encryption key, and only the daemon holds the private key. The capability and public key travel in widget-only tool-result metadata, which the host must keep out of model context. The widget needs no network access: it submits ciphertext through the host's MCP bridge. This does **not** protect against a malicious host that alters widget code or keys; the browser mode keeps a stronger boundary from the chat host. Neither mode sandboxes an approved command.

When you rebuild the widget, a connected server announces the new version; clients that honour tool-list change notifications pick it up without reconnecting. Server or daemon changes still need a restart. SecureInput never downloads or runs updates on its own.

Try the real widget with a fake key in a reference host:

```bash
npm run build
npm run demo:host
```

Open the printed loopback URL and submit a fake key. The demo writes `.env.inline-demo` with mode `0600` in a temporary directory. The reference host is a test fixture, not proof that a particular chat product supports inline apps.

Useful commands: `secureinput status`, `secureinput doctor`, `secureinput pair` (browser fallback), `secureinput stop`. The daemon listens on `http://127.0.0.1:4780`; config lives in `~/.secureinput/` with mode `0600`.

## MCP tools

### `request_secret`

Creates a secure input request and optionally waits for the user.

```json
{
  "title": "GitHub CLI login",
  "description": "Authenticate gh so I can create and push the repository.",
  "fields": [
    {
      "id": "token",
      "label": "GitHub token",
      "description": "A fine-grained token with repo access.",
      "type": "password",
      "minLength": 20
    }
  ],
  "delivery": {
    "mode": "execute",
    "command": "gh",
    "args": ["auth", "login", "--with-token"],
    "stdin": "{{token}}",
    "timeoutSeconds": 60
  },
  "waitSeconds": 30
}
```

Fields:

- `title` — short request name, max 100 characters.
- `description` — why the secret is needed, max 1000 characters.
- `cwd` — optional working directory, resolved relative to the MCP client's working directory; must resolve inside an allowed root.
- `fields` — 1–10 inputs. Each has `id`, `label`, optional `description`, `type` (`password` or `text`), `placeholder`, `minLength`, `maxLength`, `pattern` (RE2), `required`, `sensitive`, and `autocomplete`.
- `delivery` — `execute`, `write_env`, or `return` (disabled by default).
- `timeoutSeconds` — request lifetime, 30–900 seconds. Default 300.
- `waitSeconds` — how long this tool call blocks, 0–240 seconds. Default 30.

If the user has not submitted within `waitSeconds`, the result is `{ "requestId": "req_…", "status": "pending", "inputMode": "inline" }` (or `"browser"`). Call `check_secret_request` with the returned request ID.

### `check_secret_request`

Long-polls an existing request. Waits up to 45 seconds.

```json
{ "requestId": "req_…", "waitSeconds": 30 }
```

### `cancel_secret_request`

Cancels a request that is still pending.

```json
{ "requestId": "req_…" }
```

### `secureinput_status`

Returns input mode, return-mode state, and pending request IDs/statuses. Full browser/API policy responses are unchanged.

## Delivery modes

### `execute` — run a command with the secret

```json
{
  "mode": "execute",
  "command": "gh",
  "args": ["auth", "login", "--with-token"],
  "cwd": ".",
  "stdin": "{{token}}",
  "env": {},
  "timeoutSeconds": 120
}
```

- The command is spawned directly with `shell: false`. There is no shell interpolation by SecureInput.
- Secret fields can appear in `stdin` or `env` values as `{{fieldId}}`. They cannot appear in `command` or `args`. Environment variables can still be visible to other processes on some systems; prefer stdin when available.
- Non-sensitive `text` fields may be used in `args` for things like usernames.
- At least one secret reference must go through `stdin` or `env`.
- stdout and stderr are withheld from the agent. The paired local browser can show size-capped, best-effort redacted output.
- Child processes receive basic OS variables (such as PATH, HOME and temporary-directory settings), fixed terminal settings, and the explicit delivery env mapping. Other daemon environment variables are not inherited.
- The process group is terminated on timeout.
- Commands must be non-interactive. TTY-only login flows are not supported; use the tool's token/non-interactive mode instead.

### `write_env` — write a `.env` file

```json
{
  "mode": "write_env",
  "path": ".env.local",
  "mapping": {
    "secret": "STRIPE_SECRET_KEY"
  },
  "overwrite": false
}
```

- Only `.env` and `.env.*` files are allowed, and names containing `example`, `sample`, `template`, `dist`, `defaults`, or `schema` are rejected. Script-like names such as `.envrc` are not accepted.
- The parent directory must exist and resolve inside an allowed root.
- Symlinks are rejected.
- Existing keys require `overwrite: true`. The browser asks for overwrite confirmation; inline submission authorizes the requested overwrite without a separate confirmation.
- Writes are atomic and the resulting file gets mode `0600`. Existing comments, `export` prefixes, quoting style, and line endings are preserved.
- Files larger than 1 MiB are refused.

### `return` — hand the secret back to the agent (dangerous)

Disabled by default. Start the daemon with `--allow-return` to enable it:

```bash
secureinput serve --allow-return
```

The setting is persisted in the config file. Return mode puts the secret in the model context and transcript. Use it only when `execute` and `write_env` cannot solve the problem.

## What the agent sees

MCP responses are compact, minified status objects. Full request details are sent only in widget-only `_meta`; they are not repeated in model-visible content. The inline widget does not poll while input is pending. After submission it long-polls an app-only status tool, keeping UI updates out of model context.

A completed `execute` request looks like this:

```json
{"requestId":"req_…","status":"completed","exitCode":0}
```

The secret does not appear in the tool result, the request object, the SSE stream, the audit log, or the server log.

## Security model

SecureInput is built for the local-desktop threat model, not for hostile multi-user hosts.

See the [security and trust guide](docs/security-model.md) for a diagram, data locations, and a practical checklist.

**Protected by design**

- Loopback-only server, with a Host-header check that rejects DNS-rebinding attempts.
- 256-bit random MCP and pairing tokens stored in a `0600` config file.
- Pairing token exchanged for a signed, HttpOnly, `SameSite=Strict` session cookie.
- Same-origin checks and a custom CSRF header on state-changing browser requests.
- Strict CSP, `frame-ancestors 'none'`, no CORS, no-store on API and HTML entry points.
- One-time request claim, per-request TTL, pending caps, and rate limits.
- Constant-time token comparison and pairing rate limiting.
- RE2 validation patterns, which avoid regex denial-of-service.
- Submitted field values are not deliberately put in URLs, argv, logs, audit records, or error messages. The initial pairing URL contains a separate pairing token; keep it private.
- Output redaction covers raw, JSON-escaped, URL-encoded, and base64 forms of each secret, plus common token formats.
- Command execution with `shell: false`; timeout kills the process group.
- Env writes are atomic, `0600`, symlink-safe, and confined to allowed roots.
- Risk assessment marks shell/network/absolute-path commands, env overwrites, and return mode. The browser flow adds review checkboxes; the inline flow does not show those checkboxes and submission authorizes delivery.
- Audit log records metadata and outcomes only: request ID, client, delivery destination, field names, exit code, duration.

**Outside the boundary**

- A command you approve can exfiltrate the secret. Reviewing the exact command and destination is the final control.
- An agent with filesystem or terminal access may be able to read a `.env` file after it is written, or run commands that read it. Use `execute` with stdin when you do not want a persistent file.
- Same-user malware, root, a compromised browser, a malicious extension, or a keylogger can read anything you type. SecureInput does not claim to stop them.
- Environment variables can be visible to other processes running as the same user on some systems. Prefer stdin when the command supports it.
- Redaction is best-effort for transformed secrets (hashed, split, encrypted, or re-encoded output).
- Pending requests and secret values live only in memory. Restarting the daemon discards them.
- `.env` files are plaintext. SecureInput sets safe permissions but does not encrypt anything.

## Configuration

Default config directory: `~/.secureinput/`

| File | Purpose |
| --- | --- |
| `config.json` | Port, tokens, allowed roots, return/audit/browser settings. Mode `0600`. |
| `runtime.json` | Running daemon PID and port. |
| `audit.jsonl` | Metadata-only audit trail. No secret values. |
| `server.log` | Daemon log. No secret values. |

Environment variables:

| Variable | Meaning |
| --- | --- |
| `SECUREINPUT_HOME` | Override the config directory. |
| `SECUREINPUT_NO_OPEN` | Set to `1` to prevent automatic browser opening. |
| `SECUREINPUT_WEB_DIR` | Override the built web UI directory. |

Allowed roots default to your home directory. Tighten this when starting the daemon:

```bash
secureinput serve --root ~/projects
```

Repeat `--root` for multiple directories. Values are resolved and persisted on first run. Restart the daemon after changing them.

## CLI reference

```text
secureinput serve [--port 4780] [--root <path>]... [--allow-return]
                  [--no-open] [--no-audit] [--home <path>] [--web-dir <path>]
secureinput mcp   [--home <path>] [--port <port>]
                  [--client-name <name>] [--client-version <version>]
secureinput pair  [--home <path>] [--port <port>] [--no-open]
secureinput status
secureinput stop
secureinput doctor
```

- `serve` runs the daemon and opens the pairing page.
- `mcp` runs the stdio bridge and auto-starts the daemon if needed.
- `pair` starts the daemon if needed and prints a pairing URL.
- `status` shows daemon health, policy, and pending requests.
- `stop` stops the daemon.
- `doctor` checks Node version, daemon reachability, and runtime PID.

The MCP bridge inherits your current working directory and reports it to the daemon. That directory must be inside an allowed root; otherwise the request is rejected instead of silently falling back.

## HTTP API and HTTP MCP

The daemon also exposes a stateless Streamable HTTP MCP endpoint:

```text
POST http://127.0.0.1:4780/mcp
Authorization: Bearer <mcpToken from ~/.secureinput/config.json>
Content-Type: application/json
```

This is useful for clients or test harnesses that prefer HTTP over stdio. The endpoint uses JSON responses rather than long-lived SSE sessions. It is still loopback-only and requires the MCP token.

The browser UI uses authenticated REST and SSE endpoints under `/api`. Those are implementation details and may change; the MCP tools are the stable interface.

## Choose a delivery method

| Method | Useful for | What persists |
| --- | --- | --- |
| `execute` with stdin | A non-interactive CLI login or command that accepts a token on stdin | The command may store credentials itself |
| `execute` with environment variables | A command that requires an environment variable | The command may store credentials; other same-user processes may see its environment |
| `write_env` | A local application that reads a `.env` file | A plaintext file with owner-only permissions |

Use the browser input mode when you need to review the destination and risk confirmations in SecureInput itself. The compact inline form shows the input label and submits immediately; it does not show the browser's review screen. A person must be available to enter the value in either mode.

## FAQ

**Does the coding agent see my API key?**
The MCP result does not intentionally return it by default. The agent sees the request ID, status and exit code; stdout/stderr stay local. An approved command can still write or transmit values, and an agent with terminal or filesystem access may be able to read a written `.env` file. `return` mode explicitly gives the value to the agent and is disabled unless you start the daemon with `--allow-return`.

**Can I enter a secret inside the agent chat?**
Yes, by default with a compatible MCP Apps host. The widget encrypts its submission before passing it through the host to the local daemon. It uses the same local command/env-file delivery implementation; Enter authorizes inline delivery, while the browser retains its review controls. The host still controls rendering and widget metadata, so use inline input only in a host you trust. See the input-mode settings below. This is not a claim of compatibility with every chat client.

**Where are secrets stored?**
SecureInput keeps pending requests and submitted values in process memory and drops references after delivery; JavaScript memory is not guaranteed to be zeroized. `write_env` intentionally writes plaintext to the `.env` file you approve. Commands may also persist credentials themselves. Completed request metadata is kept in memory for 10 minutes, and only metadata is written to the audit log.

**Does it work with Claude Code?**
Yes. Run `claude mcp add secureinput -- secureinput mcp`. The same stdio bridge works with Cursor, Codex CLI, VS Code Copilot, Cline, Windsurf, and other MCP clients.

**Does it work with Cursor?**
Yes. Add the `mcpServers` entry shown above to Cursor's MCP config.

**Why not just use a password manager?**
A password manager is great for humans, but it is not an MCP delivery path. SecureInput focuses on getting a secret into a specific command or env file with an auditable destination, without an agent API key.

**Can the agent read my whole environment?**
A command receives a small set of OS environment variables plus the values explicitly supplied in the delivery mapping. It still runs with your OS user's permissions and may read files or credential stores. The browser mode shows the command and adds confirmations for high-risk requests; the compact inline mode does not show those details. Use the smallest credential and the narrowest scope you can.

**What happens if the daemon restarts?**
Pending requests and completed results are lost. The agent will receive a "request not found" error and can create a new request. This is deliberate: no secret vault, no stale credentials.

**Can I use it over SSH or in a dev container?**
The daemon only listens on loopback. If your browser and agent run on the same machine, it works. For remote containers, forward the port over SSH and pair from that machine's browser session; do not expose port 4780 publicly. Remote/multi-user hosting is out of scope.

**What about Windows?**
The code handles Windows process termination and paths, but CI currently runs on Linux. Treat Windows as best-effort for now.

**Is the browser UI built with shadcn/ui only?**
The UI uses shadcn/ui components, Radix primitives, Tailwind, and lucide icons. There are no third-party UI kits or external assets.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

- `npm run dev` builds the web UI and starts the daemon without opening a browser.
- `npm run dev:web` runs Vite on port 5173 and proxies `/api` to the daemon.
- `npm test` runs node:test unit and integration tests, including auth, CSRF, Origin/Host rejection, SSE, MCP over HTTP, one-time submit, expiry, redaction, env writes, and stdio bridge behavior.

Project layout:

```text
src/shared/   schemas, validation, redaction, env parser
src/server/   daemon, auth, policy, request service, delivery, audit
src/mcp/      stdio bridge
src/cli/      command-line entry point
src/web/      React + Vite + Tailwind + shadcn/ui
test/         node:test unit and integration tests
```

See [PLAN.md](PLAN.md) for the detailed design and threat model, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

MIT. See [LICENSE](LICENSE).
