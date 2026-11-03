# Security and trust

SecureInput helps a person supply a secret without deliberately placing it in an AI chat message or returning it in the default MCP tool result. It is a local desktop tool, not a secret vault or a sandbox. It cannot guarantee what a host, an agent with local access, or a command will do with a secret.

```text
Person → inline form in a trusted host ──encrypted envelope──┐
      ↘ paired localhost browser ────────────────────────────┤
                                                            ↓
                              SecureInput daemon (127.0.0.1)
                                  ├─ stdin or environment → local command
                                  └─ write_env → plaintext .env file
                                                            ↓
                                  MCP result: status / exit code by default
```

## Where the value goes

| Location | What to expect |
| --- | --- |
| Inline form | The widget encrypts the submission for the local daemon before it passes through the host's MCP bridge. The host must render the genuine widget and keep widget-only metadata out of model context. A malicious or compromised host can defeat these protections. |
| Browser fallback | The value is submitted to the paired localhost service. A compromised browser, extension, or machine can observe input. The pairing URL contains a separate sensitive pairing token. |
| Daemon memory | Submitted values are held in process memory for delivery. Dropping references does not guarantee that JavaScript memory is zeroized. |
| Command stdin or environment | The command runs with the user's OS permissions and can read, store, log, or transmit the value. Environment variables may be visible to same-user processes on some systems; prefer stdin where supported. |
| `.env` file | `write_env` intentionally writes plaintext to the specified file with owner-only permissions. An agent or process with filesystem access may subsequently read it. Keep it out of version control. |
| Tool result, logs and audit | Default agent-facing results contain status and exit information, not the submitted value or command output. SecureInput does not intentionally log values; output redaction is best effort and cannot recognize every transformation. Audit records contain request metadata. |
| Return mode | Explicitly enabling `--allow-return` permits the value to be returned to the agent. That can put it in model context and transcripts. It is disabled by default. |

## What you must trust

- **The host and agent:** inline mode relies on the host's isolation and honest rendering. An agent with terminal or filesystem access may read a written `.env` or invoke another command.
- **The delivery command:** SecureInput executes without a shell, but it does not sandbox the command or restrict its network access. A command can disclose or persist a credential.
- **The computer:** same-user malware, a keylogger, root, and compromised browser components are outside the boundary.
- **The user interface:** the compact inline form shows the input label and submits immediately; it does not show the browser's command and overwrite review controls. Use browser mode when you need those controls: `secureinput settings --input-mode browser`, then restart the server and reconnect the client.

Terminal delivery alone does not prove a value is excluded from model context, service logs, or training. Those outcomes also depend on the client, agent, destination command, and their settings.

## Before using a real credential

1. Test setup using a fake value. Check that the expected tool is connected and understand the destination.
2. Use a narrowly scoped, revocable credential. Prefer stdin over environment variables when supported.
3. Use browser mode if you want SecureInput's destination and risk review before submitting.
4. If writing a file, confirm its path, ignore it in Git, and remember it is plaintext. Revoke or rotate the credential if exposure is suspected.
5. Keep SecureInput and its dependencies updated, and use it only with hosts and commands you trust.

This document describes the intended design, not a certification or independent security audit. Report vulnerabilities privately using [SECURITY.md](../SECURITY.md).
