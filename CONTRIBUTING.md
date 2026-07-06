# Contributing to Gloss

Thanks for your interest in Gloss. This is an ESM JavaScript monorepo (npm
workspaces, Node >= 20, no build step).

## Getting started

```bash
npm install            # wires workspace deps; pulls React/Vite for the web app
npm test               # tests across core, anchor, git
npm run demo           # multi-reviewer session + compaction + stale-edit self-heal
npm run server:dev     # backend on :8787 over an in-memory host
# then, in another shell:
cd apps/web && npm run dev   # vite dev server; proxies API to :8787
```

`packages/core` tests run with zero install (relative imports); everything else
needs `npm install` first.

## Project layout

See [README.md](README.md) for the package map and [docs/protocol.md](docs/protocol.md)
for the full design and the reasoning behind the load-bearing decisions (the
ULID-per-action log, `*_decided_by` idempotent compaction, and rendered-text
anchoring). Please read the protocol doc before changing behaviour in
`@gloss/core`, `@gloss/anchor`, or `@gloss/git`.

## Conventions

- ESM JavaScript with JSDoc types throughout. No transpile/build step.
- Keep the code comments accurate — they explain load-bearing logic. If you change
  behaviour, update the comment in the same change.
- Add or update tests for any change to `core`, `anchor`, or `git`. Run
  `npm test` before opening a pull request.
- Match the existing style; keep changes focused and minimal.

## Pull requests

1. Fork and branch from `main`.
2. Make your change with tests; ensure `npm test` passes.
3. Describe the change and its motivation in the PR.

## Secrets

Never commit secrets. Configuration is via environment variables (`.env.example`
is the template; `.env` and `.azure/` are gitignored). If you spot a committed
secret, see [SECURITY.md](SECURITY.md).
