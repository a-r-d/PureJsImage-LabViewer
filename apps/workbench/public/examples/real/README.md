# Bundled real-data examples

Each JPEG is the exact public-domain source image used for the gallery preview. E. coli, HeLa, and
HHV-6 also ship a matching GSF grayscale float32 scientific-workspace derivative: E. coli retains
the source dimensions; the larger HeLa and HHV-6 sources are Lanczos-resampled to 1024 pixels wide
to keep offline reads bounded. The Staphylococcus aureus example opens the original JPEG itself
through the scientific codec adapter, without a GSF conversion. The GSF files intentionally omit
spatial calibration because the source records do not provide trustworthy machine-readable pixel
spacing. The S. aureus JPEG likewise has no embedded calibration; a 2 µm scale bar is visible only
as source annotation.

Exact byte sizes, SHA-256 digests, source records, attribution, transformation policy, and
analysis presets are declared in `packages/test-corpus/src/manifest.ts` and audited in
`docs/CORPUS_AUDIT.md`.

Do not replace, recompress, resize, or regenerate these files without requalifying the corpus
records, checking the rendered and numeric results, and updating the integrity assertions.
