# Contributing to universal-search

Thanks for your interest in contributing! This guide covers how to set up the
project, the checks your change must pass, and how to propose it.

## Prerequisites

- **Node.js ≥ 22.5** (Node 24 recommended — see `.nvmrc`). The app uses the
  built-in `node:sqlite` module, which requires this version.
- **npm** (the repo ships a `package-lock.json`).
- A **Tavily** API key for local runs — get a free one at
  [tavily.com](https://tavily.com). It's the only required key.

## Local setup

```bash
git clone https://github.com/guanyin123/universal-search.git
cd universal-search
npm install
cp .env.example .env         # then set TAVILY_API_KEY
npm run dev                  # http://localhost:5173
```

Everything else (LLM provider/keys, save directory) is configured **in-app** via
the first-run onboarding wizard, not through environment variables.

## Before you open a pull request

All three of these must pass — CI runs the same steps:

```bash
npm run check   # type-check (svelte-check)
npm test        # unit + integration tests (vitest)
npm run build   # production build (adapter-node)
```

## Conventions

- **TypeScript strict** — keep types honest; avoid `any` where a real type fits.
- **Keep files small and focused** (aim for under ~500 lines).
- **Validate input at boundaries** — API routes and external calls.
- **Tests live next to code** as `*.test.ts` and run under vitest. Add or update
  tests for any behavior you change; server logic in `src/lib/server/**` is
  well-covered and new logic should be too.
- **No secrets in commits** — never commit `.env` or real API keys. `.env` is
  gitignored; use `.env.example` (placeholders only) to document new variables.

## Project layout (quick map)

| Path | What lives there |
|------|------------------|
| `src/routes/` | SvelteKit pages + API endpoints (`api/**/+server.ts`) |
| `src/lib/server/pipeline/` | Query proposal, compression, synthesis, tagging |
| `src/lib/server/search/` | Search providers (Tavily, community, Exa, Unsplash, GitHub) |
| `src/lib/server/runs/` | Run state machine + persistence |
| `src/lib/server/workflows/` | Save/replay reusable workflows |
| `src/lib/server/vault/` | Atomic vault writes + git auto-commit |
| `src/lib/server/settings/` | Encrypted settings store (channels, save dir) |

## Pull request process

1. Fork the repo and create a topic branch from `main`.
2. Make your change with tests; keep the PR focused on one thing.
3. Ensure `check`, `test`, and `build` pass locally.
4. Open the PR with a clear description of **what** and **why**; link any related
   issue.

By contributing, you agree that your contributions are licensed under the
project's [Apache License 2.0](./LICENSE).
