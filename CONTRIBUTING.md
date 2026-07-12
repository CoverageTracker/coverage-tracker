# Contributing

Thanks for considering a contribution to coverage-tracker. This is a small,
self-hostable project — most changes should be small too.

## Project layout

This repo has **three independent `package.json`s**, each with its own
dependencies:

| Directory                 | What it is                                            |
| ------------------------- | ----------------------------------------------------- |
| `/` (root)                | The Cloudflare Worker — Hono API + cron rollup        |
| `dashboard/`              | SvelteKit 5 dashboard, builds into the Worker         |
| `.github/actions/report/` | The reporting GitHub Action (parses coverage reports) |

Install and work on each independently:

```bash
npm install                              # root (Worker)
npm --prefix dashboard install           # dashboard
npm --prefix .github/actions/report install
```

See the root [README.md](README.md#development) for the full local dev loop
(`wrangler.json`, `.dev.vars`, D1 migrations, `npm run dev`).

## Before opening a PR

Run these at the root, unless you only touched one sub-project:

```bash
npm run lint            # ESLint (root)
npm run format:check     # Prettier (root)
npm run typecheck        # tsc --noEmit
npm test                 # vitest, real D1 bindings via @cloudflare/vitest-pool-workers
```

Or check formatting across all three projects at once:

```bash
npm run format:all:check
```

CI (`.github/workflows/ci.yml` and `action-test.yml`) runs the equivalent
checks plus Playwright e2e tests and an Action self-test — a PR won't merge
until those are green.

## Architecture invariants

Before touching auth, routing, or the D1 schema, read
[CLAUDE.md](CLAUDE.md) — it documents the non-negotiable invariants for this
project (single Worker serving both the SPA and the API, why `/api/*` must
never sit behind a Cloudflare Access application, the two-table coverage
rollup contract, etc.). PRs that violate one of those invariants will be
asked to change regardless of whether the tests pass.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`, `refactor:`, optionally
scoped (`fix(report): ...`). Look at `git log` for examples.

## Code review

[docs/CODEOWNERS](docs/CODEOWNERS) lists who reviews changes to specific
paths. Secret scanning runs automatically via GitGuardian — don't commit
`.dev.vars`, `wrangler.json`, or any real credentials (see the templates:
`.dev.vars.example`, `wrangler.example.jsonc`).

## License

By contributing, you agree your contribution is licensed under this repo's
[MIT License](LICENSE).
