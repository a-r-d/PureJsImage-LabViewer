# Workbench application

This is the client-only React composition root. It uses the official Cloudflare Vite plugin and
has no backend entry point.

## Isolated tooling type workaround

`tsconfig.node.json` enables `skipLibCheck` only for the Vite configuration project. The pinned
`@cloudflare/vite-plugin@1.52.1` and `wrangler@4.123.0` declaration bundles currently reference
undeclared tooling-only modules through Miniflare, including `@cloudflare/workers-utils`,
`@cloudflare/workers-shared`, and `@cloudflare/workers-types/experimental`. Those declarations
cannot be checked from a strict pnpm installation without adding Cloudflare's internal/dev type
graph as direct application dependencies.

`tsconfig.app.json`, every workspace package, and the PureJsImage public-boundary smoke compile
retain `skipLibCheck: false`. Remove this exception when the upstream tooling declarations are
self-contained.
