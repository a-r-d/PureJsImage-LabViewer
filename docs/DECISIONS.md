# Initial architecture decisions

These decisions are defaults for the first repository skeleton. Change them only with a short architecture decision record explaining the problem and measurable tradeoff.

## React over Preact

Use React.

The application shell is not the performance bottleneck. Large-data performance depends on:

- bounded file reads;
- worker isolation;
- tile scheduling and caching;
- viewport draw-call discipline;
- typed-array transfer and ownership;
- avoiding broad state subscriptions;
- virtualized result rendering.

React provides the lowest ecosystem and compatibility risk for accessible components, error boundaries, testing, browser tooling, and future embedded integrations. Do not use React state as the tile cache or pixel pipeline.

## pnpm workspaces plus Turborepo

Use pnpm for deterministic workspace dependency management and Turborepo for task orchestration and caching.

Use TypeScript project references underneath this. Turborepo does not replace TypeScript's dependency graph.

## Vite plus Cloudflare

Use a plain client-side Vite React application and the official Cloudflare Vite plugin. Avoid adopting a full-stack React framework before the application needs server rendering or route loaders.

The initial workbench is one desktop-style route. Settings, dataset inspection, results, and the agent are workbench panels rather than separate pages.

## Source-only private packages

Workspace packages are `private: true` and consumed from source during development. Their build outputs exist for boundary testing and production builds, not publication.

Do not add Changesets, semantic-release, independent package versions, or npm publishing jobs until a package has an identified external user.

## One client now, multiple clients possible later

`apps/workbench` is the only client. Shared packages must not import from it. A future viewer embed, teaching client, pathology client, or desktop shell can compose the same packages.

## Backend boundary without speculative backend code

Do not create a fake CRUD API merely to reserve a directory.

The client depends on interfaces in `packages/contracts`, such as:

- object storage locator;
- project store;
- compute-job service;
- plugin registry;
- identity/session service.

The first implementations remain local. A future open-source Docker service or hosted proprietary implementation can satisfy the same contracts.

## Local-first agent credentials

The initial OpenRouter key is stored in browser local storage because that is the requested onboarding model. The UI must state that local storage is readable by JavaScript running on the origin and by sufficiently privileged browser extensions.

The key must never enter:

- project exports;
- analysis graphs;
- agent history exports;
- application logs;
- telemetry;
- URLs;
- error reports.

Wrap storage behind a credential-store interface so a backend token broker can replace it later.

## No arbitrary plugin execution in the first skeleton

The first plugin system supports:

- declarative analysis recipes;
- trusted locally installed modules during development;
- manifests and capability declarations;
- an editor and compile/validate flow behind a feature flag.

Pasted or AI-authored code must not execute in the window realm. A future sandbox uses a dedicated Worker/iframe or a purpose-built WASM JavaScript runtime with explicit capabilities and quotas.

## Public PureJsImage package boundary is sacred

The app may import only documented package exports such as:

```text
purejsimage/scientific
purejsimage/scientific/browser
purejsimage/scientific/readers/*
purejsimage/analysis
purejsimage/analysis/roi
purejsimage/analysis/results
purejsimage/analysis/runtime
purejsimage/analysis/project
purejsimage/operations
purejsimage/extensions
```

Never import `purejsimage/src/*`, copied internal types, or unpublished files.
