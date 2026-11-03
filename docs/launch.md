# Launch and feedback

SecureInput is an open-source local MCP server for entering credentials outside an agent chat message and delivering them to a local command or `.env` file. The default MCP result contains status rather than the value. Inline input needs a compatible, trusted host; the fallback is a paired browser on localhost.

## Shareable overview

When a coding agent needs an API key, SecureInput offers a separate input form. It can pass the value to a local command through stdin or an environment variable, or write it to a local `.env` file. It does not intentionally return the value in the default MCP response.

The host and command still matter: a command can transmit or store the value, and `.env` files are plaintext. The compact inline form submits immediately; use browser mode for SecureInput's destination and risk review.

[Source and installation](https://github.com/r69shabh/secureinput) · [Illustrated overview](media/secureinput-overview.mp4) · [Security model](security-model.md) · [Give feedback](https://github.com/r69shabh/secureinput/issues/new/choose)

For communities, check current self-promotion rules, disclose the author relationship, and ask whether the setup solves a real workflow. Do not imply that a visual illustration is a recording or that SecureInput prevents a host, agent, or command from accessing a secret. Follow each community's rules on automated or AI-generated posts.

## Measure without tracking users

From a GitHub-authenticated shell with access to the repository, run:

```bash
bash scripts/adoption-snapshot.sh
```

Compare release asset downloads, GitHub stars and forks, rolling repository views and clones, and feedback issues over time. GitHub traffic is a rolling 14-day aggregate; clones can include bots, CI, mirrors, and repeat activity. Downloads are not verified installations. GitHub activity cannot tell us whether someone completed setup or returned to use the tool. Ask for that information voluntarily in issues or conversations; do not collect secrets, pairing URLs, private logs, or telemetry from the application.
