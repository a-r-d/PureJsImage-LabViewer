# Codex prompt 09 — Cloudflare deployment

```text
Continue in the repository after product hardening.

Read AGENTS.md and docs/ARCHITECTURE.md. Inspect current official Cloudflare Vite-plugin documentation and the actual app configuration. Preserve changes. Do not publish a production deployment or create remote Cloudflare resources unless explicitly requested.

Make the workbench ready for deterministic Cloudflare preview/production deployment as a client-side application.

## Deployment model

Use the official Cloudflare Vite plugin and static asset/Worker configuration appropriate for a React SPA.

Requirements:

- SPA fallback for application routes;
- immutable hashed asset caching;
- no caching for HTML/service control files where stale shell behavior would be harmful;
- correct MIME for workers/WASM/assets;
- cross-origin isolation only if deliberately required and tested;
- strict Content Security Policy compatible with Worker modules, WebGL, OpenRouter HTTPS requests, and no unsafe-eval;
- security headers;
- source maps policy documented;
- no secret embedded in client bundle;
- remote scientific files remain direct browser requests unless future policy says otherwise.

Do not add a proxy for arbitrary remote URLs.

## Environment configuration

Implement typed public configuration for:

- app build ID;
- optional error-reporting endpoint disabled by default;
- allowed OpenRouter origin;
- feature flags;
- corpus/sample base URL where appropriate.

Do not treat client environment variables as secrets.

## Deployment scripts

Provide:

- local Cloudflare development;
- production build;
- deployment dry-run;
- preview deployment command documented but not executed without permission;
- build artifact inspection;
- CSP/static header validation;
- rollback documentation based on immutable builds.

## CI

Add deployment-ready jobs that:

- build from clean lockfile;
- run complete deterministic checks;
- run Cloudflare dry-run/config validation;
- inspect output for forbidden secret/test/corpus material;
- upload build/test artifacts;
- optionally deploy a preview only when repository permissions/secrets are configured later.

No CI job should require a Cloudflare token for ordinary pull requests.

## Offline and failure behavior

Do not add a broad service-worker cache in this prompt unless there is already a deliberate offline design. Incorrect caching of scientific sources or app versions is worse than no offline mode.

Ensure:

- app shell reports Worker startup failure;
- stale asset mismatch gives reload/recovery guidance;
- OpenRouter outage does not break manual analysis;
- remote-source CORS/range failure remains distinct from app deployment failure.

## Tests

Add tests for:

- built HTML/assets under intended paths;
- SPA deep-link fallback;
- security headers/CSP;
- worker module loading;
- no eval/new Function;
- no keys/secrets;
- no corpus archives in bundle;
- OpenRouter and range-source connect-src policy;
- production build browser smoke;
- deployment dry-run.

## Documentation

Document local Cloudflare development, configuration, preview/production steps, headers, CORS responsibilities for remote datasets, and future backend options.

## Verification

Run build, Cloudflare dry-run, static/security inspection, production Playwright smoke, browser checks, and pnpm check.

Report exact Cloudflare package/plugin versions, output directory and asset policy, headers/CSP, dry-run result, build sizes, test results, git diff --stat, and remaining deployment requirement.

Do not commit, push, or deploy.
```
