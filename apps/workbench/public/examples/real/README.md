# Bundled real-data examples

Each JPEG is the exact public-domain source image used for the gallery preview. Each matching GSF
is a grayscale float32 scientific-workspace derivative: E. coli retains the source dimensions;
the larger HeLa and HHV-6 sources are Lanczos-resampled to 1024 pixels wide to keep offline reads
bounded. The GSF files intentionally omit spatial calibration because the source records do not
provide trustworthy machine-readable pixel spacing.

Exact byte sizes, SHA-256 digests, source records, attribution, transformation policy, and
analysis presets are declared in `packages/test-corpus/src/manifest.ts` and audited in
`docs/CORPUS_AUDIT.md`.

Do not replace, recompress, resize, or regenerate these files without requalifying the corpus
records, checking the rendered and numeric results, and updating the integrity assertions.
