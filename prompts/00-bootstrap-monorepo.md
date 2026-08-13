# Codex prompt 00 — bootstrap the monorepo

```text
You are starting a new repository for a browser-native scientific imaging product.

Working repository name: purejsimage-materials-workbench
Working product name: Materials Workbench

Before editing:

1. Inspect the complete current tree and git status.
2. Read AGENTS.md and every file under docs/.
3. Preserve all existing user changes.
4. Do not commit, push, publish, deploy, or create remote resources.

Bootstrap a strict, production-quality monorepo skeleton.

## Product boundary

This is a React browser application consuming `purejsimage@0.10.0` through public package exports. It targets materials science and electron-microscopy workflows.

The application must eventually support multiple clients and an optional backend, but only one client is implemented now. Do not create speculative CRUD/backend logic.

## Toolchain

Use current mutually compatible stable releases, verified from official project/package metadata at implementation time:

- Node 24 LTS;
- Corepack-managed pnpm 10;
- pnpm workspaces;
- Turborepo;
- React 19;
- Vite;
- official Cloudflare Vite plugin;
- TypeScript strict mode;
- Biome for formatting and linting;
- Vitest;
- Playwright;
- React Testing Library only where DOM-oriented component tests need it.

Pin exact resolved versions in package.json/lockfile. Do not use floating `latest` ranges after initialization.

Do not add ESLint, Prettier, Jest, Webpack, Storybook, a component framework, a state framework, an RPC framework, or a schema library unless the current repository already deliberately includes one and the docs justify it.

## Monorepo structure

Create:

apps/
  workbench/

packages/
  contracts/
  workspace/
  imaging/
  viewport/
  agent/
  plugin-sdk/
  ui/
  test-corpus/

apps-e2e/
  workbench/

tooling/
  typescript/
  vitest/
  playwright/
  scripts/

services/
  README.md

Keep all workspace packages private. Do not add package publishing/versioning machinery.

## Root configuration

Create and validate:

- package.json with packageManager pinned to the exact pnpm version;
- pnpm-workspace.yaml;
- turbo.json;
- strict shared TypeScript configs using project references/incremental builds;
- biome.json;
- .editorconfig;
- .gitignore;
- .npmrc with safe deterministic pnpm settings;
- dependency-boundary checker configuration/script;
- Vitest workspace/configuration;
- Playwright base configuration;
- environment type declarations;
- GitHub Actions CI skeleton;
- Cloudflare/Vite app configuration;
- root README with commands and repository map.

Use ESM throughout.

## TypeScript contract

The shared strict config must enable at least:

- strict;
- noUncheckedIndexedAccess;
- exactOptionalPropertyTypes;
- useUnknownInCatchVariables;
- noImplicitOverride;
- noFallthroughCasesInSwitch;
- noPropertyAccessFromIndexSignature;
- verbatimModuleSyntax;
- isolatedModules for browser packages;
- forceConsistentCasingInFileNames;
- incremental/composite where applicable.

Do not use skipLibCheck unless an actual dependency issue makes it necessary. If needed, document the exact issue and isolate the workaround.

Every package must have explicit public exports and no accidental deep-import contract.

## App

Create `apps/workbench` as a client-side React Vite SPA using the official Cloudflare Vite plugin.

Requirements:

- one root workbench route;
- no SSR framework;
- no backend dependency;
- basic error boundary;
- CSP-compatible code with no eval;
- environment validation without exposing secrets;
- Cloudflare static asset configuration appropriate for SPA fallback;
- development, production build, preview, and deployment dry-run scripts.

Render a minimal accessible page proving the app starts. Do not build the full UI in this prompt.

## Package skeletons

Each package must:

- have package.json with private: true;
- expose ESM and declarations for boundary testing;
- have tsconfig references;
- have one small tested export proving build/test wiring;
- avoid React unless the package is `ui` or a deliberate React adapter;
- avoid DOM types in contracts/workspace/agent/plugin-sdk core unless required by an explicit adapter.

`packages/imaging` should declare a dependency on `purejsimage@0.10.0` but must not yet implement the full integration. Add a compile-time package-boundary smoke test using documented public imports only.

Inspect the installed package declarations/exports rather than guessing APIs.

## Root scripts

Expose:

- dev
- build
- check
- typecheck
- lint
- format
- format:check
- test
- test:watch
- test:e2e
- test:a11y
- test:visual
- test:corpus
- test:performance
- deploy:dry-run
- clean

`pnpm check` should run deterministic normal-CI checks in a useful fail-fast order.

## Architecture boundaries

Implement an automated boundary test or script that rejects at least:

- package imports from apps;
- any `purejsimage/src` import;
- PureJsImage runtime imports outside packages/imaging except explicitly allowed types/subpaths documented later;
- React imports in contracts and workspace core;
- app imports crossing directly into another package's source-private path.

Use existing TypeScript/import graph tooling or a small repository script. Do not add a large architecture dependency for this alone.

## CI

Create jobs for:

1. quality: formatting, lint, typecheck, unit tests, boundaries;
2. build: all package/app builds and bundle budget script;
3. browser Chromium smoke test;
4. Firefox/WebKit smoke test;
5. security/static checks.

Use pnpm cache and concurrency cancellation. Do not require secrets.

## Documentation

Update the root README with:

- mission;
- prerequisites;
- commands;
- monorepo map;
- package boundaries;
- local development;
- Cloudflare dry run;
- testing philosophy;
- statement that backend services are not implemented yet.

Do not rewrite the supplied product/architecture documents except to correct implementation-specific facts.

## Verification

Run:

- pnpm install --frozen-lockfile after the lockfile exists;
- pnpm format;
- pnpm lint;
- pnpm typecheck;
- pnpm test;
- pnpm build;
- pnpm test:e2e for the smoke test;
- pnpm deploy:dry-run;
- pnpm check.

Fix all failures caused by the bootstrap. Do not skip checks.

At the end report:

- exact tool versions selected;
- repository tree;
- package dependency graph;
- root commands;
- Cloudflare build output;
- focused and full check results;
- git diff --stat;
- any remaining bootstrap blocker.

Do not commit or push.
```
