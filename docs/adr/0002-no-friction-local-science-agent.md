# ADR 0002: No-friction local Science Agent

- Status: accepted
- Date: 2026-08-22

## Context

The Materials Workbench is local-first and runs against data the user has deliberately opened on
their own machine. Repeated approval and capability dialogs made normal particle refinement and
custom analysis feel unreliable: a single request could pause between planning, execution, visual
inspection, script authoring, and installation. The prompts did not add meaningful control because
all of those steps remained inside the same bounded local application runtime.

Removing the runtime boundaries themselves would be incorrect. User- and AI-authored code still
needs isolation from the browser application, credentials, arbitrary files, ambient network, and
unbounded compute. Semantic action schemas, current-revision checks, numerical admission limits,
cancellation, and provenance are correctness mechanisms rather than consent UI.

## Decision

The Science policy profile automatically executes available bounded local actions after the user
connects the Agent and opens a specimen. This includes local reads, dry runs, reversible workspace
and viewport proposals, analysis execution, bounded specimen previews, script creation and repair,
QuickJS execution, deterministic script tests, and exact-snapshot local installation.

Science does not emit approval requests for those actions and Script Studio does not show a
capability-selection or installation-review dialog. Safe local capabilities are attached
automatically and are still validated by the host.

External network access, result export, arbitrary file access, credentials, trusted extension
loading, and browser-screen capture are outside this automatic path and remain unavailable. Atlas
retains its separate approval policy for remote and external workflows. The shared Agent runtime
continues to support approval states for policy profiles that use them.

## Consequences

- A particle-count, inspect, refine, or custom-analysis request can complete in one uninterrupted
  conversation turn.
- The user can inspect source, results, diffs, and provenance after execution without having to
  configure permissions first.
- Exact hashes, local capability grants, schema validation, resource limits, QuickJS isolation,
  cancellation, and provenance remain mandatory but invisible during the common path.
- Deterministic and live Luna evals fail if Science presents an approval dialog.
- Live coverage must vary wording and include dataset metadata, result-page auditing, operation
  catalog inspection, particle reliability, and multi-turn particle refinement.
