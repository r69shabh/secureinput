# SecureInput — private API key input for AI coding agents

[![CI](https://github.com/r69shabh/secureinput/actions/workflows/ci.yml/badge.svg)](https://github.com/r69shabh/secureinput/actions/workflows/ci.yml)

**Give an AI coding agent the access it needs without pasting your API key into chat.** SecureInput is an open-source, local-first Model Context Protocol (MCP) server for API keys, passwords, and tokens. It collects input in an inline MCP App when the host supports it, or in a paired localhost browser otherwise. It can pass the value to a local command through stdin or environment variables, or write it to a `.env` file.

The default MCP response contains status and exit information, not the secret. The MCP bridge is designed for stdio clients such as Claude Code, Cursor, Codex, VS Code / GitHub Copilot, Windsurf, and Cline; inline display depends on the host's MCP Apps support. macOS and Linux require Node.js 22 or newer.

**[Install](#install)** · **[Connect your agent](#connect-your-coding-agent)** · **[Security and trust](docs/security-model.md)** · **[FAQ](#faq)**

[Watch the 20-second illustrated overview](docs/media/secureinput-overview.mp4) · [Run the real widget with a fake key](#browser-or-inline-input)

```
agent: "I need a GitHub token to create the repo."
        │
        ▼
  request_secret (MCP)
        │
        ▼
  inline form in a compatible host, or paired localhost browser
        │
        ▼
  SecureInput daemon on 127.0.0.1
        ├── execute: gh auth login --with-token   (token through stdin)
        └── write_env: .env.local                 (plaintext file, mode 0600)
        │
        ▼
agent: { "ok": true, "status": "completed", "exitCode": 0 }
```

## Why this exists

Coding agents constantly need credentials. The usual options are bad:

| Approach | What goes wrong |
| --- | --- |
| Paste the key into chat | It enters the model context, transcript, logs, and possibly telemetry. |
| Agent prints a terminal command | You have to run it manually; the key can end up in shell history or `ps`. |
| Type it into a terminal prompt | Fine, but repetitive, easy to mistype, and impossible for remote or headless agents. |
| Commit a `.env` by hand | Easy to get wrong permissions, duplicate keys, or commit the file. |

SecureInput provides a separate input path for the credential. By default it does not return the value in the MCP tool result. The inline host, commands you run, and applications with access to a written `.env` file remain part of the trust boundary. See [Security model](#security-model).

## Features

- **MCP-native** — one tool, `request_secret`, plus polling, cancellation, and status tools.
- **Local only** — binds to `127.0.0.1`; pairing token, signed session cookie, Origin and CSRF checks.
- **No secret in chat by default** — the agent receives request status and exit details. stdout/stderr are withheld from MCP results.
- **Direct command execution** — no shell, secrets supplied through stdin or environment variables, never command-line arguments.
- **Safe `.env` writes** — atomic replace, `0600` permissions, comments and line endings preserved, `.env` and `.env.*` only.
- **Two input modes** — the compact inline form submits on Enter; the paired browser offers request details and additional confirmations for risky actions.
- **One-time requests** — pending requests expire, results are short-lived, and a submission can only be claimed once.
- **Defense in depth** — RE2-safe validation patterns, value/output size caps, ANSI stripping, output redaction, audit metadata without values.
- **Small shadcn/ui frontend** — the UI is intentionally boring: pairing, a request list, a form, and a result.
- **Opt-in return mode** — for clients that truly need the value back; disabled by default and clearly marked dangerous.

## Requirements

- Node.js 22 or newer
- macOS or Linux (Windows is supported in code but not yet covered by CI)
- An MCP Apps-compatible host, or a browser on the same machine for fallback

## Install

### Claude Desktop: download the bundle

1. Download `secureinput-release-0.1.0.mcpb` from [GitHub Releases](https://github.com/r69shabh/secureinput/releases/tag/v0.1.0). This bundle is unsigned; review the source and release before installing it.
2. In Claude Desktop, open **Settings → Desktop app → Manage** next to Extensions (or **Settings → Extensions** in older versions), then **Advanced settings → Install Extension…** and select the downloaded file. Availability can depend on your organization's settings. See [Claude's installation guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
3. Check that SecureInput is connected in Claude's connectors or extensions settings, then ask for a test using a **fake** key. Inline input depends on host support; otherwise use the paired local browser.

The bundle requires a Node.js 22-compatible runtime and supports macOS and Linux. This is a directly downloaded bundle, not an official Claude directory listing. To update it, download and install a newer bundle; a GitHub push does not update an installed copy automatically.

### Install from source

The npm package is not published. Install from this repository, or download the [MCP bundle from GitHub Releases](https://github.com/r69shabh/secureinput/releases) for an MCPB-compatible client. The bundle requires Node.js 22 or newer and is currently unsigned.

```bash
git clone https://github.com/r69shabh/secureinput.git
cd secureinput
npm ci
npm run build
npm link          # puts `secureinput` on your PATH
```

Add SecureInput to your [MCP client](#connect-your-coding-agent). The first client connection starts the local daemon automatically. To start it yourself and pair the browser fallback:

```bash
secureinput serve
```

Inline requests do not open a browser. When a client needs the browser fallback, its pairing page opens automatically if browser opening is enabled. You can also open and pair it manually:

```bash
secureinput pair
```

You can also check that everything is healthy:

```bash
secureinput status
secureinput doctor
```

The daemon listens on `http://127.0.0.1:4780`. The config lives in `~/.secureinput/` with mode `0600`.

> `npm link` is just for local use. `npm install -g .` or an absolute path to `dist/cli/index.js` works too.

## Browser or inline input

When the local inline widget is rebuilt, a connected SecureInput server announces the updated resource automatically. Clients that honor MCP tool-list change notifications can use the new form for subsequent requests without reconnecting; already-open forms keep their original version. Some clients may need a reconnect if they do not refresh tool metadata. Installing this refresh capability itself requires restarting the existing MCP process once.

A GitHub push does not install updates on users' computers: update the local checkout and rebuild it first. The refresh mechanism updates the widget only; changes to the running server or daemon may still require a restart. SecureInput does not silently download or execute updates.

Inline input is the default on compatible MCP Apps clients. If the client cannot render it, SecureInput automatically opens paired localhost browser input. No browser is opened for supported inline requests, and Enter authorizes the requested delivery without an additional SecureInput confirmation dialog. The host may still apply its own MCP tool permissions.

Existing explicit browser-only preferences are preserved. To switch an existing installation to inline-first:

```bash
secureinput settings --input-mode inline
secureinput stop
```

Reconnect your MCP clients to apply a changed setting. Use `secureinput settings --input-mode browser` only if you want to force browser input.

Inline requires a host advertising the MCP Apps HTML capability. Text-only clients automatically use the browser. Both modes deliver to the same local `execute` or `write_env` implementation. The inline form shows only the field label and a rounded outline input with an inset submit arrow. In inline mode, Enter authorizes the requested delivery, including an overwrite explicitly requested by the agent; the browser flow keeps its separate review controls. The inline form encrypts values and a one-request capability with AES-256-GCM; a fresh RSA-OAEP-SHA-256 key pair wraps the encryption key. Only the daemon holds the private key. The capability and public key are supplied in widget-only tool-result metadata; the host must keep that metadata out of model context. Inline return-to-agent delivery is unsupported and uses the browser instead.

The inline widget needs no direct network access: it submits ciphertext through the host's MCP bridge. This does **not** protect against a malicious host that alters widget code or keys. The local browser retains a stronger boundary from the chat host. Neither mode sandboxes an approved command's filesystem or network access, and no “never trained” claim follows from merely using terminal commands.

For a synthetic local test of the actual widget and terminal-to-env flow:

```bash
npm run build
npm run demo:host
```

Open the printed loopback URL and submit a fake key. The reference host renders the real MCP App inside a restricted iframe; the demo Node command writes `.env.inline-demo` with mode `0600` in an isolated temporary directory. The compact inline form does not display the command for review. This reference host is a test fixture, not proof that a particular chat product supports inline apps. Use real credentials only in a separately evaluated host.

## Connect your coding agent

SecureInput runs as a stdio MCP bridge. The first client that needs it auto-starts the shared daemon; you only pair the browser once.

### Claude Code

```bash
claude mcp add secureinput -- secureinput mcp
```

Run `claude mcp list` to check the connection. Add `--scope user` before `secureinput` if you want the configuration available across projects.

### Cursor

Add to `~/.cursor/mcp.json` (or the project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "secureinput": {
      "command": "secureinput",
      "args": ["mcp"]
    }
  }
}
```

### Codex CLI

Register the server using the Codex CLI:

```bash
codex mcp add secureinput -- secureinput mcp
codex mcp list
```

Alternatively, add to `~/.codex/config.toml`:

```toml
[mcp_servers.secureinput]
command = "secureinput"
args = ["mcp"]
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "secureinput": {
      "type": "stdio",
      "command": "secureinput",
      "args": ["mcp"]
    }
  }
}
```

### Any MCP client

Use a stdio server with command `secureinput` and argument `mcp`.

```json
{
  "mcpServers": {
    "secureinput": {
      "command": "secureinput",
      "args": ["mcp"]
    }
  }
}
```

If the executable is not on `PATH`, use the absolute path to `dist/cli/index.js`:

```json
{
  "mcpServers": {
    "secureinput": {
      "command": "node",
      "args": ["/absolute/path/to/secureinput/dist/cli/index.js", "mcp"]
    }
  }
}
```

Add an instruction like this to your agent rules so it reaches for the tool instead of asking for a pasted key:

```text
When you need an API key, password, or token, call the SecureInput MCP tool
request_secret. Do not ask me to paste secrets into chat. Prefer delivery
mode "execute" with the secret in stdin/env, or "write_env" for .env files.
```

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
