# ADR 0001: Shared showcase monorepo

- Status: Accepted
- Date: 2026-08-18
- Supercedes: the “one client now, multiple clients possible later” default in
  [`docs/DECISIONS.md`](../DECISIONS.md)

## Context

This repository currently hosts separately built showcase applications. Science deploys
at `lab.purejsimage.com`. PureJsImage itself is a separate core-library repository.

PureJsImage itself is a separate core-library repository. This application
repository exists to turn that library into end-user workflows. Additional
showcase domains (geospatial now, medical later) need the same local-first,
calibrated, Worker-isolated raster model without turning the present science
workbench into a kitchen-sink runtime or cloning the entire application for
each domain.

The existing science workbench must keep its current behavior while the
repository is prepared for multiple separately built applications.

## Decision

This repository becomes a **shared showcase monorepo**.

1. **Initial applications are gallery, science, and geo.** Medical is a planned
   later application and is not created until implementation of that domain
   begins.
2. **Each domain application is separately built and deployed.** Science,
   geospatial, and later medical do not share one runtime bundle, one Worker
   catalog, or one Cloudflare asset tree.
3. **A lightweight gallery application links to each domain application.** The
   gallery is a directory and launcher, not a host that loads domain runtimes.
4. **Shared behavior is supplied through a compile-time domain profile.** A
   profile selects readers, trusted analysis extensions, semantic actions,
   examples, branding, and deploy metadata. Unused domain code is dropped at
   build time.
5. **This is not a runtime third-party plugin ecosystem.** Trusted build-time
   extensions, sandboxed user/AI scripts, and the existing recipe/script review
   flow remain. Third parties do not install domain applications into a running
   host.
6. **PureJsImage remains a separate core-library repository.** This monorepo
   continues to import only documented public package exports.
7. **UI and future AI agents invoke the same semantic actions.** Domain
   applications compose one `WorkbenchActionHost` per app. There is no
   privileged agent path around schema validation, policy, dry-run, approval,
   or cancellation.
8. **Large raster work remains behind the existing Worker boundary.**
   `packages/imaging` stays the live PureJsImage orchestration package. Domain
   profiles may change which readers and trusted extensions the Worker
   registers; they do not move decoding, analysis, or tile lifecycle onto the
   React render path.

## Rejected alternatives

### Cloned standalone applications

Rejected: copying `apps/workbench` into independent repositories or
near-duplicate application trees per domain.

That would fork semantic actions, Worker contracts, persistence, tests, and
security policy. Bug fixes and characterization coverage would diverge. Shared
packages already exist to prevent this.

### A single runtime kitchen-sink super app

Rejected: one deployed application that loads science, geo, medical, and
gallery workflows at runtime through a plugin host, dynamic import marketplace,
or “enable this domain” switch that keeps every reader, operation, and example
in one bundle.

That would:

- defeat per-domain bundle and Worker budgets;
- mix incompatible default catalogs, examples, and UX;
- create a third-party runtime plugin surface this product is not building;
- make the science workbench accidentally lose behavior during unrelated domain
  work.

Separate builds plus a compile-time profile keep sharing without a super app.

## Package and application boundaries

Current layout:

```text
apps/gallery                 Lightweight links to deployed domain apps
apps/science                 Electron microscopy / materials workbench
                             (lab.purejsimage.com)
apps/geo                     Empty geospatial profile on the shared shell
                             (geo.purejsimage.com)
apps/medical                 Not created until that domain is implemented

packages/actions             Shared semantic action descriptors and host
packages/contracts           JSON-safe Worker/RPC/persistence contracts
packages/workspace           Immutable revisioned project state
packages/imaging             Sole live PureJsImage Worker orchestration
packages/viewport            Framework-neutral camera/render contracts
packages/ui                  Generic accessible React primitives
packages/plugin-sdk          Script/recipe contracts, not a store
packages/scripts             Isolated QuickJS script Worker
packages/agent               Agent policy; invokes the same action host
packages/test-corpus         Licensed scenario manifests
packages/workbench-core      Headless shared runtime and profile types
packages/workbench-react     Shared React workbench shell
packages/domain-science      Science catalogs, workflows, actions, panels
packages/domain-geo          Empty geo profile and terminology
packages/materials-analysis  Trusted science/materials extension bundle
packages/<domain>-analysis   Future trusted domain extension bundles
```

Rules that remain in force:

- Applications compose packages; packages never import applications.
- `packages/imaging` and explicit trusted extension packages are the only
  normal PureJsImage runtime owners.
- `packages/actions` stays free of React and live datasets.
- `packages/ui` stays free of scientific data access.
- Feature folders inside an app must not form import cycles.
- A domain profile is compile-time data plus static imports, not a global
  singleton and not a runtime registry of foreign code.

## Compile-time domain profile

A domain profile is a build-time module imported by one application entry. The
initial science profile is the current workbench: its action catalog, reader
list, materials/analysis extension, example corpus filter, shell title, and
Cloudflare route.

A profile may specify:

- application id (`gallery` | `science` | `geo` | later `medical`);
- display name and deployment hostname;
- reader ids registered in the imaging Worker;
- trusted analysis extension modules;
- semantic action modules composed into one registry;
- enabled example/corpus predicates;
- lazy UI surfaces that exist for that domain.

A profile must not:

- fetch and execute third-party plugins;
- keep another domain’s raster stack resident “just in case”;
- give the agent a private implementation of file open, analysis, or
  persistence;
- bypass Worker isolation for large rasters.

Gallery’s profile is intentionally small: copy, links, and provenance text. It
does not open scientific documents.

## Deployment model

Each application produces its own Vite client bundle and Cloudflare assets.

| Application | Deploy | Notes |
| --- | --- | --- |
| Science workbench | `apps/science` → `lab.purejsimage.com` | Cloudflare worker `purejsimage-materials-workbench` |
| Gallery | separately built; no apex custom domain | This repo does not deploy `purejsimage.com` |
| Geo | `apps/geo` → `geo.purejsimage.com` | Cloudflare worker `purejsimage-geo` |
| Medical | none | created with its first implementation |

Cutover rules:

- Do not merge domain bundles into one upload to save a hostname.
- Do not share IndexedDB/localStorage origins across domain apps.
- SPA fallback stays per application.
- Bundle budgets are per application build. Science keeps the current 300 KiB
  gzip route-chunk ceiling and 1,000 KiB gzip language-Worker ceiling until a
  later ADR changes them.

## Semantic actions and agents

Every domain application keeps one versioned JSON-safe action registry.

- The normal UI, command palette, recipes, scripts, tests, and future agent
  call the same host.
- Exact action versions remain replayable.
- Availability, permissions, mutability, cost, cancellation, dry-run, and
  provenance stay on the descriptor.
- Domain profiles compose action modules; they do not create a second tool
  language for the agent.

## Worker boundary

File parsing, scientific document lifecycle, analysis planning/execution, and
tile production stay in the imaging Worker (or another explicit isolated
runtime). React state continues to hold semantic references and UI models, not
source pixels or complete large result tables.

Domain-specific readers and trusted operations are registered inside that
Worker according to the compile-time profile. They are not reimplemented in
route components.

## Migration sequence

Steps 1–5 are implemented. Medical remains later.

1. **Record:** architecture decision, action/reader/route snapshots, Worker
   characterization of open/analyze/save, and recorded science bundle/performance
   baselines.
2. **Profile the science app:** explicit science domain profile.
3. **Add `apps/gallery`:** separately built linker with no imaging Worker.
4. **Move science:** `apps/workbench` → `apps/science` without changing
   `lab.purejsimage.com` or the Cloudflare worker name.
5. **Add `apps/geo`:** empty geo profile and shared shell. Do not load geo code
   into the science build.
6. **Add medical later:** create `apps/medical` when that domain is actually
   implemented, not as an empty placeholder runtime.

Each step must keep the science characterization tests failing on accidental
removal of boot, example open, local open, action catalog, reader registry,
analysis execution, project save/load, and the current routes including
`/__ui-lab`.

## Consequences

- Sharing happens through packages and compile-time profiles, not clones and
  not a kitchen-sink host.
- Science bundle size and Worker catalog can shrink later by omitting other
  domains; they must not shrink by dropping recorded science behavior.
- Gallery remains cheap to load because it does not ship raster runtimes.
- Future agents stay clients of the per-app action host.
- Characterization fixtures are reviewed locks. Normal CI must not regenerate
  them on failure.

## Out of scope for the original ADR commit

The first ADR commit recorded the decision without moving apps. Later work added
gallery, moved science, and added geo. Still out of scope:

- Introducing a new state library.
- Publishing workspace packages.
- A runtime plugin marketplace.
- Implementing medical imaging.
