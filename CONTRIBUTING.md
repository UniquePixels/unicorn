# Contributing to Unicorn

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- [mise](https://mise.jdx.dev/) (installs Bun and Biome at the correct versions automatically)
- Git

> [!TIP]
> If you prefer not to use mise, install [Bun](https://bun.sh/) (v1.3+) and [Biome](https://biomejs.dev/) (v2.4+) manually.

## Getting Started

```bash
# Clone the repository
git clone https://github.com/uniquepixels/unicorn.git
cd unicorn

# Install tools (if using mise)
mise install

# Install dependencies
bun install
```

## Development Workflow

### Quality Gate

Run the full quality gate before submitting changes:

```bash
bun qa          # Format + lint + typecheck + test (run this before every commit)
```

Individual checks:

```bash
bun qa:format   # Auto-format with Biome
bun qa:lint     # Lint with Biome
bun qa:tsc      # Type check with TypeScript
bun qa:test     # Run tests with coverage
bun test        # Run tests only
```

### Code Style

- **Formatting and linting** are handled by Biome — run `bun qa:format` to auto-fix
- **Filenames** must be `kebab-case`
- **Imports** use `import type { ... }` for type-only imports
- **No `console`** — use `client.logger` instead
- **No `process.env`** — use config or `Bun.env`

## Documentation

All exported functions, classes, and types must have JSDoc docstrings. When adding or modifying a core module or built-in guard/spark, update both inline JSDoc and the corresponding file in `docs/`.

### Docs structure

| File | Covers |
|---|---|
| `docs/commands.md` | `defineCommand`, `defineCommandWithAutocomplete`, `defineCommandGroup` |
| `docs/components.md` | `defineComponent`, parameterized IDs, component routing |
| `docs/gateway-events.md` | `defineGatewayEvent`, one-time vs recurring events |
| `docs/scheduled-events.md` | `defineScheduledEvent`, cron expressions |
| `docs/guards.md` | Guard system, built-in guards, creating custom guards |
| `docs/errors.md` | `AppError`, `attempt()`, error handling strategy |
| `docs/configuration.md` | Configuration schema, secrets, environment variables |

### Guidelines

- Keep examples minimal — show one concept per code block
- Use `attempt()` for all fallible Discord API calls in examples (kick, ban, send, etc.)
- Import guards as `import * as g from '@/guards/built-in'`
- When adding a new guard, add a section in `docs/guards.md` and update the API reference table at the bottom

## Submitting Changes

### Developer Certificate of Origin (DCO)

This project uses the [DCO](https://developercertificate.org/). All commits must include a `Signed-off-by` line:

```bash
git commit -s -m "your commit message"
```

The `-s` flag automatically adds the sign-off using your Git name and email. The DCO check will fail on pull requests with unsigned commits.

> [!IMPORTANT]
> If you forget to sign off, you can amend your last commit:
> ```bash
> git commit --amend -s --no-edit
> ```
> For multiple commits, see [how to sign off previous commits](https://github.com/src-d/guide/blob/master/developer-community/fix-DCO.md).

### Pull Requests

1. Fork the repository and create a descriptive branch
2. Make your changes and ensure `bun qa` passes
3. Sign all commits with DCO (`git commit -s`)
4. Open a pull request against `main`

Pull requests require:
- Passing CI checks (lint, typecheck, tests)
- Code review approval
- DCO sign-off on all commits

## Fork/Clone Cleanup

If you fork Unicorn to build your own bot (rather than contributing back), review these CI/tooling files and remove or update anything that references the upstream project:

| File / Directory | Action | Why |
|---|---|---|
| `.github/workflows/` | Review all workflows | Fork gating (`github.repository == 'UniquePixels/unicorn'`) will skip jobs in your fork. Remove the conditions or update to your repo name. |
| `.coderabbit.yaml` | Remove or reconfigure | CodeRabbit review config — only useful if you have CodeRabbit enabled on your repo. |
| `cliff.toml` | Update `[remote]` section | The `repo` field points to the upstream GitHub repo for changelog links. |
| `.sonarcloud.properties` | Remove | SonarCloud config — only works with the upstream project key. |
| `commitlint.config.ts` | Keep or customize | Commit message format rules. Keep if you want the same convention. |
| `biome.jsonc` | Keep | Linting and formatting config — generally useful as-is. |
| `README.md` badges | Update URLs | CI status badges reference the upstream repo. |
| `CONTRIBUTING.md` | Update | Clone/fork URLs and issue tracker links reference the upstream repo. |
| `LICENSE` | Update copyright | Update the copyright holder to your name/org. |

> [!TIP]
> You can safely delete everything in `.github/workflows/` and start fresh — the framework itself has no dependency on CI.

## Reporting Issues

- **Bugs and feature requests** — use the [issue tracker](../../issues)
- **Security vulnerabilities** — please [report privately](/../../../security/advisories/new). **Do not** open a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
