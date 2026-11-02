# Contributing

Thanks for helping make secret handoff for coding agents less terrible.

## Development setup

```bash
git clone https://github.com/r69shabh/secureinput.git
cd secureinput
npm ci
npm run build
```

Useful commands:

```bash
npm run typecheck   # server + web TypeScript
npm test            # node:test unit + integration tests
npm run build       # bundle CLI and web UI
npm run dev         # build web and start the daemon without opening a browser
npm run dev:web     # Vite dev server with /api proxy to the daemon
```

## Pull requests

- Keep changes focused. This project deliberately has a small surface.
- Add or update tests for behavior changes. Security-sensitive changes need a negative test too.
- Run `npm run typecheck`, `npm test`, and `npm run build` before opening a PR.
- Do not commit secrets, `.env` files, test homes, `dist/`, or `node_modules/`.
- Keep the UI on shadcn/ui components. No new UI kits or external assets.
- Preserve the single `main` branch workflow; no long-lived feature branches.

## Security changes

Read [SECURITY.md](SECURITY.md) first. If you are fixing a vulnerability, open a private advisory rather than a public PR with exploit details. Do not weaken loopback binding, token checks, Origin/CSRF checks, path confinement, argv restrictions, or redaction to make a feature easier.

## Code style

- TypeScript strict mode.
- Shared browser-safe code goes in `src/shared`.
- Node-only code goes in `src/server`, `src/cli`, or `src/mcp`.
- Prefer the existing helpers and patterns over new abstractions.
- Comment only non-obvious tradeoffs, with a one-line reason.

## License

By contributing, you agree that your contribution is licensed under the MIT License.
