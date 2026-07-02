# universal-search · 万能搜索

> **English** | [简体中文](./README.zh-CN.md)

[![CI](https://github.com/guanyin123/universal-search/actions/workflows/ci.yml/badge.svg)](https://github.com/guanyin123/universal-search/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

A local research tool that turns a question into a synthesized report — and files
it into your notes. You ask something, edit the AI-proposed multi-source search
plan, and the app searches in parallel, compresses each source, synthesizes a
report with a strong model, and (optionally) deposits it into your Obsidian vault
with an automatic git commit.

The whole loop is a reusable pattern: **editable search plan → a cheap model for
breadth → a strong model to close → a safe, guarded write to your vault.**

<!-- To add a screenshot, drop an image at docs/screenshot.png and uncomment: -->
<!-- ![universal-search](./docs/screenshot.png) -->

## Features

- **Three search modes**
  - **Report** — multi-dimensional research (Web, Communities, People's Writing,
    Images). The AI proposes 2–3 queries per dimension; you edit them, then it
    searches in parallel, compresses results, and synthesizes a Markdown report.
  - **GitHub** — describe a tool you need; it proposes GitHub queries, searches,
    and ranks repos by reputation + fit.
  - **Quick** — a direct passthrough to web search (no LLM, no plan) for fast
    URL + snippet results.
- **Provider-agnostic LLM** — works with any OpenAI-compatible endpoint (OpenAI,
  DeepSeek, Ollama, etc.). A cheap "fanout" model handles breadth; a strong
  "synth" model writes the final report. Configure providers in the app.
- **Reusable workflows** — save a successful run as a workflow and replay it on
  similar questions to skip straight to searching.
- **Safe vault deposit** — atomic writes (temp → rename), path validation inside
  the vault, and an automatic git commit that only stages the files it wrote.

## Quick start (npm)

**Prerequisites:** Node.js **≥ 22.5** (Node 24 recommended — the app uses the
built-in `node:sqlite`). A free [Tavily](https://tavily.com) API key.

```bash
git clone https://github.com/guanyin123/universal-search.git
cd universal-search
npm install
cp .env.example .env      # then set TAVILY_API_KEY (the only required variable)
npm run dev               # → http://localhost:5173
```

On first launch, an **onboarding wizard** walks you through picking an AI
provider + model and setting your save directory. That's it — everything else is
optional.

## Quick start (Docker)

Run the whole thing with one command — no Node install needed.

```bash
cp .env.example .env      # set TAVILY_API_KEY
docker compose up --build # → http://localhost:3000
```

App state (settings + run history) is persisted to `./.data` and `./.runs` on
your host. To enable **deposit to vault**, uncomment the vault volume in
[`docker-compose.yml`](./docker-compose.yml) and set your save directory to
`/vault` in the app's settings.

> Note: dev mode runs on port **5173** (Vite); the Docker/production server runs
> on port **3000** (adapter-node).

## Configuration

Configuration lives in two places, by design:

- **In-app (recommended):** your LLM provider/keys and save directory are set
  through the onboarding wizard and **Settings → Manage Channels**, stored
  encrypted in a local SQLite database (`.data/`).
- **Environment (`.env`):** only `TAVILY_API_KEY` is required. The rest are
  optional seeds/toggles.

| Variable | Required | Purpose |
|---|:---:|---|
| `TAVILY_API_KEY` | **Yes** | Web search — the only variable the app requires to boot |
| `VAULT_ROOT` | No | Save-directory seed (prefer setting this in-app) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `FANOUT_MODEL` / `SYNTH_MODEL` / `LLM_MODELS` | No | First-run LLM seed (prefer **Manage Channels** in-app) |
| `COMMUNITY_ENABLED` | No | Set to `true` to enable the Communities dimension |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | No | Reddit app-only OAuth (needed from data-center IPs) |
| `EXA_API_KEY` | No | Enables the "People's Writing" dimension (Exa) |
| `UNSPLASH_ACCESS_KEY` | No | Enables the "Images" dimension (Unsplash) |
| `JINA_API_KEY` | No | URL → Markdown reader (works on the free tier if blank) |
| `GITHUB_TOKEN` | No | Higher rate limits for GitHub search mode |

## How it works

1. You enter a question.
2. The AI proposes 2–3 search queries per dimension — add, edit, or remove them.
3. On confirm, it searches all sources in parallel and compresses each one.
4. A strong model synthesizes a report using the default "Smart Research" template.
5. Preview the report → confirm → deposit into your vault + auto-commit.

### Search dimensions & keys

| Dimension | Source | Key |
|---|---|---|
| Web | Tavily | **required** (`TAVILY_API_KEY`) |
| Communities & Sites | Reddit + Hacker News | optional (`COMMUNITY_ENABLED`, Reddit OAuth) |
| People's Writing | Exa | optional (`EXA_API_KEY`) |
| Images | Unsplash | optional (`UNSPLASH_ACCESS_KEY`) |

Optional dimensions are silently skipped when their key is missing — web search
always works.

## Production build

```bash
npm run build     # build the adapter-node server
node build        # serve on http://localhost:3000 (honors PORT / HOST)
```

## Testing

```bash
npm test          # unit + integration tests (vitest)
npm run check     # type-check (svelte-check)
```

## Roadmap

- **v1** — single Web dimension, full pipeline end-to-end. ✅
- **v2** — Communities (Reddit/HN), People's Writing (Exa), and Images (Unsplash)
  dimensions; tag reuse from your vault + automatic `related[]` links. ✅
- **v3 (current)** — save a successful run as a reusable workflow
  (`.research-workflows/<slug>.md`) and replay it to skip proposal/editing and
  jump straight to parallel search, reusing that workflow's report template and
  synthesis prompt. ✅

## Known limitations

The **retrieval + synthesis** half is solid end-to-end. The **deposit-to-vault**
half is currently limited on very large, iCloud-synced Obsidian vaults:

- **Whole-tree cleanliness check** — before writing, the app asserts the vault is
  clean via a full `git status`. Obsidian plugins that constantly rewrite
  un-gitignored cache files (e.g. `.obsidian/*`, `.smart-env/*.ajson`) keep the
  tree perpetually "dirty", blocking deposit.
- **iCloud `git status` latency** — on a large vault synced through iCloud, a full
  `git status` can take a very long time (I/O-bound file materialization).

**Workaround:** enable `core.fsmonitor` and `core.untrackedCache` on your vault's
git repo. Scoping the cleanliness check to only the deposit target paths is a
tracked improvement — contributions welcome.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup
and the checks your change should pass. Please also read our
[Code of Conduct](./CODE_OF_CONDUCT.md). For security issues, see
[SECURITY.md](./SECURITY.md).

## License

[Apache License 2.0](./LICENSE) © guanyin
