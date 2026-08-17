# Usability test protocol

Hands-on session notes live in `docs/USABILITY_TEST_LOG.md`. This file is the
moderated-scientist protocol; the log is the running record of what we actually tried.

## Purpose and scope

This protocol tests whether a scientist can complete the core PureJsImage Lab workflow without coaching. It evaluates task completion, readability, navigation, accessibility, and perceived performance. It is not a test of the participant.

Prompt 13 uses the generated calibrated-particles scenario so the session is reproducible and no participant source data is required. A later moderated session may use a participant file only after explicit opt-in.

## Consent and privacy

Before starting, explain what will be recorded and obtain consent. Record task timing, interaction notes, errors, backtracking, unclear labels, and confidence only. Do not collect source pixels, local filenames, credentials, screen recordings, voice, or identifiable information without a separate explicit opt-in. The application remains local-first; the protocol must not introduce network telemetry.

Participants may pause or stop at any time. Remove session notes on request. Use a neutral participant identifier rather than a name.

## Session setup

- Start from a fresh workbench with the default dark theme at 1440 by 900 CSS pixels.
- Keep browser zoom at 100 percent for the primary run; repeat the first two tasks at 200 percent.
- Offer keyboard, pointer, or mixed input according to the participant's normal practice.
- Do not name controls or reveal the path. Ask the participant to think aloud only if comfortable.
- Use the generated calibrated-particles example unless the task explicitly calls for a failure.

## Tasks

For each task, read only the goal. Stop timing when the participant says the goal is complete or gives up.

1. **Open an example and find pixel calibration.** From the empty workbench, choose the generated calibrated-particles example. Report the pixel calibration and where its source is shown.
2. **Draw an ROI and measure mean intensity.** Create a rectangular region on the specimen and find its mean intensity, including the units or the explicit lack of physical intensity units.
3. **Count particles and remove edge objects.** Run the particle workflow, enable the edge-object exclusion policy, and report the retained count.
4. **Open a result row and locate its object.** Select one particle table row and identify the corresponding object in the specimen overlay.
5. **Inspect or edit the recipe that produced the result.** Find the operation graph or recipe, identify the threshold step, and change a parameter without accidentally committing repeated history entries.
6. **Write a short custom script using the API explorer.** Open Script Studio, use the API explorer to add one bounded analysis action, validate it, and explain the permissions shown before execution.
7. **Recover from a failed or cancelled analysis.** Start an analysis, cancel it (or use the supplied deterministic failure), then return to a usable specimen view and confirm that the prior committed project is intact.
8. **Ask the agent for the same analysis and inspect its proposal.** Find the Agent affordance and determine whether a proposal can be reviewed. Until Prompt 14, success means correctly recognizing the explicit disabled state and that no model or network request occurred.

## Metrics and observer notes

Record these fields per task:

| Field | Guidance |
| --- | --- |
| Outcome | Completed, completed with help, abandoned, or unavailable by design |
| Completion time | Seconds from goal read to participant confirmation |
| Errors | Actions that moved away from the goal or changed unintended state |
| Backtracking | Count and describe reversals or reopened surfaces |
| Unclear labels | Participant's wording and the label they expected |
| Confidence | Participant rating from 1 (guessing) to 5 (certain) |
| Observer note | Factual behavior, not an interpretation of intent |

Also record viewport size, zoom, theme, input method, assistive technology, dataset scenario, and app commit. Separate observed facts from hypotheses and proposed fixes.

## Moderator prompts

Use neutral prompts only: “What are you looking for?”, “What do you expect that to do?”, and “What tells you the task is complete?” If the participant is blocked for 60 seconds, record the block before offering one minimal hint.

## Structured issue template

```text
Title: [UX][task N] concise observed friction
Session: anonymous-id / app commit / viewport / zoom / theme / input
Task goal:
Observed behavior:
Expected cue or outcome:
Outcome and time:
Errors and backtracking:
Unclear label or missing feedback:
Confidence (1-5):
Accessibility impact:
Reproduction steps using generated data:
Evidence (privacy reviewed):
Hypothesis (clearly marked):
Suggested acceptance test:
```

## Prompt 13 self-review — 2026-08-14

This is an implementation self-review, not scientist feedback. It used the protocol's first-use path, live browser inspection, current automated workflows, and existing deterministic screenshots.

High-confidence friction found and addressed:

- The app bar mixed project, file, and viewport operations into one long row. Project actions are now grouped and compact, while Fit, 1:1, and rendered export live beside the specimen.
- The empty state gave a new user only one generated-sample path. It now exposes local file, verified examples, bounded remote URL, and saved-project starts, with explicit local-first privacy text.
- Essential panel and metadata text reached 9 pixels and inspector labels truncated. The shell now uses a 13 pixel base, an 11 pixel essential-text floor, larger panel headings, and wider default panels.
- The navigator stopped at sources and datasets. It now exposes the existing layer, ROI, and pinned-result hierarchy and links selections to the relevant inspector or results surface.
- History appeared in both the contextual inspector and the bottom drawer. The inspector duplicate is removed; persisted older history selections safely fall back to Info content while history remains in the drawer.
- Viewport context did not keep calibration and view controls together. Calibration, Fit, 1:1, and rendered export are now adjacent to the specimen.
- The stable mode rail did not show Browse selection and the future Agent control competed with active modes. Browse now has a non-color selected state and Agent remains visibly disabled at the bottom of the rail.
- There was no local evidence for interaction response or loading stability. Test mode now records bounded task durations, next-paint latency for pan, zoom, tabs, ROI, and threshold actions, plus cumulative layout shift. Production creates no UX metrics object and sends no telemetry.

Questions requiring actual scientist feedback:

- Do materials scientists expect “ROI” or “Region” in the primary navigation, and should measurements be a distinct mode?
- Is calibration prominent enough while preserving maximum specimen area?
- Which operation categories and recent/favorite behaviors reduce search time for real workflows?
- Should Script Studio stay modal at current task depth or become a docked full-height surface?
- Which result columns must remain visible while locating objects in large particle tables?
- Does the disabled Agent explanation set the right expectation before Prompt 14, or is it distracting?
- Are the default navigator, inspector, and drawer sizes comfortable on laboratory displays and at 200 percent zoom?
