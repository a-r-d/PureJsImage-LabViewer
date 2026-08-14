# Prompt 05 visual-baseline report

Date: 2026-08-14

## Deterministic environment

- Canonical renderer: Chromium with Linux-named goldens on every host.
- Viewport: 1440 × 900 for workbench and wide UI-lab states; 960 × 720 with a full-page
  capture for the narrow UI-lab state.
- Device scale factor: 1.
- Locale/timezone: `en-US` / UTC.
- Color scheme: dark unless the light UI-lab route is requested.
- Reduced motion: enabled; screenshot animations and caret blinking disabled.
- Fonts: `document.fonts.ready` completes before capture.
- Persistence: a fresh Playwright context supplies empty IndexedDB; local storage resets once per
  test and remains intact across deliberate reloads.
- Visible generated UUIDs and localized timestamps are fixed by the test bootstrap.
- Readiness: screenshots require real Worker, canvas-render, and analysis-settled attributes.

## Intentional changes

- Added the 42 px mode rail, with selected and honestly disabled states.
- Replaced the general hand-maintained icon paths with Lucide icons.
- Raised compact/essential workbench text to 11–13 px and kept numerical readouts monospace.
- Removed the decorative viewport grid whenever a real dataset is rendered.
- Added the catalog-backed operation-browser shell in the analysis inspector.
- Corrected light-theme primary-button contrast using a theme-specific accent-text token.
- Added bounded UI-lab goldens for dark wide, light wide, and dark narrow states.

The four changed loaded-workbench goldens differed from the previous shell by 6–7 percent, which
is expected from the new rail, typography, icons, and inspector layout. The image content,
calibration readouts, bounded-tile behavior, result surfaces, and scientific tolerances were not
changed or masked.

## Stability evidence

Before updating, two independent captures were byte-identical for all seven changed/new images.
Representative SHA-256 values:

```text
workbench-opened-scientific  711744cb4c63251f20cadc68680005491fc46f613d0abd0b59e5fb0baeef1930
workbench-materials-analysis 1e89706d049f5964d645a4fad32389794f0f91c41f3ca8f92e4cc132bc463934
workbench-display-scientific a3502a88a1c2aad300e0f8480d3005089f1a03a43033838a17deea1e84e95c23
workbench-agent-scientific   fc6fba1f310cf82014da7c55dea196fbe33314eaa218c97c5e9b39da46db8b98
ui-lab-dark-wide             fa4087dfe73c36b9c93a26d0ae1aa8433d8f185247526aac3895bef6d7f9e1bc
ui-lab-light-wide            96d3404974376de9e05e2a06a845c23f869c4594fa784fe276a72471ca08f66f
ui-lab-dark-narrow           8381214f02d46b598f4e435ab4bdf79080256eb446bd5ae5acdd7908fc6a4ee1
```

After the intentional update, `pnpm test:visual` passed three consecutive no-update runs: 8/8,
8/8, and 8/8. The complete Playwright matrix then passed with 65 tests and 16 expected
non-Chromium visual skips.
