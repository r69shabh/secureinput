# Directory listings

Status and copy-ready text for MCP directories. Each one needs the maintainer to sign in and submit.

## Status

| Directory | Status | How it updates |
| --- | --- | --- |
| [npm](https://www.npmjs.com/package/secureinput) | Live, 0.1.1 | `npm publish` (2FA) |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=secureinput) | Live, 0.1.1 (npm + mcpb) | "Publish MCP Registry listing" workflow after bumping `server.json` |
| [HOL Guard](https://hol.org/guard/extensions) | Live (hashgraph-online/hol-guard#7094); publisher page claimed by @r69shabh, launch story not yet published | Extension Studio (sign in, GitHub linked) |
| [Claude Desktop extensions directory](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) | Not submitted | Anthropic's extension submission form, with the `.mcpb` from the latest release |
| [Smithery](https://smithery.ai) | Not available | Accounts and submissions shut down Oct 31, 2026; now a curated Arcade directory |
| [Glama](https://glama.ai/mcp/servers/r69shabh/secureinput) | Claimed, author verified | Admin tab on the listing; a Glama release needs a Dockerfile build |
| [Cursor directory](https://cursor.directory/plugins/secureinput) | Submitted 2026-11-09; hidden until their security scan finishes | Edit from the plugin page |
| [mcp.so](https://mcp.so/submit) | Not submitted | Now a paid ($39) submission |
| [PulseMCP](https://www.pulsemcp.com/submit) | Submissions paused | Will ingest the official registry when it reopens |

## Copy

**Name:** SecureInput

**Tagline (60):** Type API keys into the chat's own input, not the chat itself.

**Short description (160):** Local MCP server for API keys and tokens. You type the value into a native inline input; it goes to a local command or .env file. The agent gets status only.

**Long description:**

SecureInput is an open-source, local-first MCP server for API keys, passwords, and tokens. When a coding agent needs a credential, it calls `request_secret`. You type the value into a small input that renders inside the chat (MCP Apps hosts), styled with the host's own theme, or into a paired page on 127.0.0.1. The value is encrypted to the local daemon and delivered to a command through stdin or environment variables, or written to a `.env` file with mode 0600. The agent receives `{ ok, status, exitCode }`, not the secret.

Commands run without a shell and secrets are rejected in arguments; command folders and `.env` paths must sit inside allowed roots. Requests are one-time and expire. MIT licensed.

The approved command, the host that renders the inline form, and anything that can read a written `.env` file are still trusted. See the security model.

**Install:** `npx -y secureinput mcp` (Node.js 22+, macOS and Linux)

**Category:** Security / Developer tools

**Links:** repo https://github.com/r69shabh/secureinput · npm https://www.npmjs.com/package/secureinput · security model https://github.com/r69shabh/secureinput/blob/main/docs/security-model.md · license MIT

**Tools:** `request_secret`, `check_secret_request`, `cancel_secret_request`, `secureinput_status`

**Disclosure:** listed by the author.
