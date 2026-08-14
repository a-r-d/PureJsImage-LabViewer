# Materials Workbench

Materials Workbench is a browser-native, local-first scientific imaging workbench for
electron microscopy and adjacent engineering imagery. It consumes `purejsimage@0.10.0`
through documented public package exports and keeps original files in the browser unless
the user deliberately chooses a network action.

This bootstrap provides the strict monorepo, package boundaries, tests, and accessible
single-route application shell. Scientific file opening and analysis workflows are added in
later milestones described under [`prompts/`](prompts/).

## Prerequisites

- Node.js 24 LTS (the exact repository version is in `.nvmrc`)
- Corepack enabled
- pnpm 11.21.0, selected through the root `packageManager` field

```sh
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the workbench Vite development server |
| `pnpm build` | Build packages and the app, then enforce the bundle budget |
| `pnpm check` | Run the deterministic normal-CI merge gate |
| `pnpm typecheck` | Type-check every workspace project |
| `pnpm lint` | Run Biome, architecture boundaries, and static security checks |
| `pnpm format` | Format the repository with Biome |
| `pnpm format:check` | Check formatting without writing |
| `pnpm test` | Run all Vitest projects |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:e2e` | Run the Playwright smoke suite in all three browsers |
| `pnpm test:a11y` | Run accessibility-tagged Chromium checks |
| `pnpm test:visual` | Run deterministic visual-invariant checks |
| `pnpm test:corpus` | Validate the generated-corpus package skeleton |
| `pnpm test:performance` | Run the initial browser performance budget |
| `pnpm deploy:dry-run` | Build and validate the Cloudflare upload without deploying |
| `pnpm clean` | Remove generated workspace output |

## Repository map

```text
apps/workbench             React 19 SPA and Cloudflare composition root
apps-e2e/workbench         Playwright product smoke tests
packages/contracts         JSON-safe cross-runtime contracts
packages/workspace         Immutable semantic workspace foundations
packages/imaging           Sole PureJsImage runtime integration boundary
packages/viewport          Framework-neutral camera/render contracts
packages/agent             Agent policy and deterministic tool-host foundations
packages/plugin-sdk        Declarative plugin and recipe contracts
packages/ui                Generic accessible React UI primitives
packages/test-corpus       Scientific corpus manifest foundations
tooling/typescript         Shared strict TypeScript configuration
tooling/vitest             Shared unit-test configuration
tooling/playwright         Shared browser-test documentation
tooling/scripts            Boundary, security, and bundle-budget checks
services                   Documented future backend boundary only
```

## Package boundaries

Applications compose packages; packages never import applications. `packages/imaging` is
the only package allowed to import the PureJsImage runtime. Packages expose only their root
entry point, and direct `src` deep imports are rejected by the architecture check. Contracts,
workspace, agent, and plugin core remain framework and DOM independent.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the complete dependency and runtime
model.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The one client route is served by Vite. The application validates its small public build-time
environment contract; secrets must not use the `VITE_` prefix.

## Cloudflare dry run

The official Cloudflare Vite plugin produces the static client output. SPA fallback is declared
in `apps/workbench/wrangler.jsonc`. Validate the generated worker and asset manifest without
creating remote resources:

```sh
pnpm deploy:dry-run
```

## Testing philosophy

Tests begin at public package boundaries, use deterministic local fixtures, and add browser,
corpus, accessibility, visual, security, and performance coverage as behavior is implemented.
No normal test uses a live API key, live model, or uncontrolled external dataset. Checks never
regenerate scientific or visual goldens automatically.

## Backend status

Backend services are not implemented. Local file viewing, analysis, projects, and future BYOK
agent use must remain complete browser-local workflows. [`services/README.md`](services/README.md)
records the optional future service boundary without speculative CRUD code.
