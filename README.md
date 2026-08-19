# Materials Workbench

Materials Workbench is a browser-native, local-first scientific imaging workbench for
electron microscopy and adjacent engineering imagery. It consumes `purejsimage@0.12.0`
through documented public package exports and keeps original files in the browser unless
the user deliberately chooses a network action.

The science workbench and PureJsImage Atlas are the current product surfaces. Notable product
changes are recorded in [`CHANGELOG.md`](CHANGELOG.md).

The repository is a shared showcase monorepo: separately built gallery, science, and geo
applications, with medical added later. Shared behavior is a compile-time domain profile.
Science lives in `apps/science` (`packages/domain-science`). This repository deploys UI
apps on Cloudflare subdomains; it does not publish the library homepage at
`purejsimage.com` (GitHub Pages from the core-library repo).

See [`docs/adr/0001-shared-showcase-monorepo.md`](docs/adr/0001-shared-showcase-monorepo.md).

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
| `pnpm dev` / `pnpm dev:science` | Run the science Vite development server |
| `pnpm dev:workbench` | Compatibility alias for `pnpm dev:science` |
| `pnpm dev:gallery` | Run the gallery linker |
| `pnpm dev:geo` | Run PureJsImage Atlas |
| `pnpm build` | Build every package and app, then enforce bundle budgets |
| `pnpm build:science` / `build:gallery` / `build:geo` | Build one application |
| `pnpm test:science` / `test:gallery` / `test:geo` | Run that app's Vitest project |
| `pnpm check` | Run the deterministic normal-CI merge gate |
| `pnpm typecheck` | Type-check every workspace project |
| `pnpm lint` | Run Biome, architecture boundaries, and static security checks |
| `pnpm format` | Format the repository with Biome |
| `pnpm format:check` | Check formatting without writing |
| `pnpm test` | Run all Vitest projects |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:e2e` | Run all Playwright science and geo browser projects |
| `pnpm test:e2e:science` | Run the science Playwright suite |
| `pnpm test:e2e:geo` | Run the geo Atlas Playwright suite |
| `pnpm test:a11y` | Run accessibility-tagged Chromium checks |
| `pnpm test:visual` | Run deterministic visual-invariant checks for science and geo |
| `pnpm test:corpus` | Validate the generated-corpus package skeleton |
| `pnpm test:performance` | Run the initial browser performance budget |
| `pnpm deploy:dry-run` | Validate science, geo, and gallery Cloudflare uploads without deploying |
| `pnpm clean` | Remove generated workspace output |

## Repository map

```text
apps/gallery               Lightweight linker (Science, Geo, planned Medical)
apps/science               Materials workbench → lab.purejsimage.com
apps/geo                   PureJsImage Atlas → geo.purejsimage.com
apps-e2e/science           Playwright product tests for the science app
apps-e2e/geo               Playwright tests for Atlas catalog, remote COG, and X-ray
packages/domain-science    Science catalogs, workflows, actions, and panels
packages/domain-geo        Geo domain model, CRS helpers, STAC client, catalog registry, Atlas copy
packages/workbench-core    Headless shared runtime and profile types
packages/workbench-react   Shared React workbench shell
packages/contracts         JSON-safe cross-runtime contracts
packages/workspace         Immutable semantic workspace foundations
packages/imaging           Sole PureJsImage runtime integration boundary
packages/viewport          Framework-neutral camera/render contracts
packages/agent             Agent policy and deterministic tool-host foundations
packages/plugin-sdk        Declarative plugin and recipe contracts
packages/ui                Generic accessible React UI primitives
packages/test-corpus       Scientific corpus manifest foundations
packages/materials-analysis  Trusted science/materials algorithm package
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

The science app is served by Vite (`pnpm dev`). Gallery and geo have their own
dev servers. Secrets must not use the `VITE_` prefix.

## Hosts and Cloudflare deploy

| Host | What | This repo? |
| --- | --- | --- |
| `purejsimage.com` | PureJsImage library site | No. GitHub Pages from the core-library repository. |
| `lab.purejsimage.com` | Science workbench | Yes. Worker `purejsimage-materials-workbench`. |
| `geo.purejsimage.com` | Geo showcase | Yes. Worker `purejsimage-geo`. |

Gallery is separately built (`@pji-workbench/gallery`) and is **not** bound to apex
`purejsimage.com`.

Cloudflare Git integration for **lab.purejsimage.com** should use:

```text
pnpm --filter @pji-workbench/science exec wrangler deploy
```

That replaces `pnpm --filter @pji-workbench/app exec wrangler deploy`. The Wrangler
`name` (`purejsimage-materials-workbench`) and custom domain are unchanged.

Geo:

```text
pnpm --filter @pji-workbench/geo exec wrangler deploy
```

## Cloudflare dry run

Each app has its own `wrangler.jsonc`. Validate generated workers and asset manifests
without creating remote resources:

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
