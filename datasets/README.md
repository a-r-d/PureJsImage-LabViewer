# Dataset corpus

`corpus.yaml` is the reviewed source of truth for external scientific datasets.

The actual repository should implement:

```text
pnpm corpus:list
pnpm corpus:verify
pnpm corpus:fetch --id <id>
pnpm corpus:fetch --tier ci
pnpm corpus:clean
```

Rules:

- `enabled` entries may be fetched automatically.
- `candidate` entries require license/integrity review before download.
- generated fixtures are created deterministically by scripts.
- downloaded data lives under a Git-ignored cache directory.
- archive extraction enforces file-count, byte, depth, and path-traversal limits.
- a resolved lock file records final URLs, checksums, and extracted selections.

The starter manifest intentionally leaves several real archives as candidates until the new repository pins exact selected files and SHA-256 values.
