# Codex prompt 15 — local agent evals final hardening


You are working in `a-r-d/PureJsImage-LabViewer` after prompts 00–04.

The baseline originally inspected for this revised roadmap was commit `3729a846a084e38ae830c429ff5b30d448537cb2`, but do not assume that is still HEAD.

Before editing:

1. Read `AGENTS.md` and every architecture/product document relevant to this prompt.
2. Report the current HEAD and `git status --short`.
3. Inspect the current implementation and tests instead of assuming filenames or APIs from this prompt are exact.
4. Preserve every user change.

Do not commit, push, merge, deploy, publish packages, modify remote metadata, weaken tests, or regenerate visual/numerical goldens merely to make a gate pass. Leave one complete inspectable working-tree diff.

The app is already deployed at `lab.purejsimage.com`; deployment work is out of scope.


## Goal

Add a local-only paid-model evaluation harness for the OpenRouter agent and perform final integrated correctness/security/performance hardening. Live model calls must never run in normal CI.

Integrate `docs/AGENT_EVALS.md`.

## Local eval harness

Add gitignored:

```text
.env.agent-evals.local
.local/agent-evals/
```

Provide commands:

```text
pnpm eval:agent --suite smoke
pnpm eval:agent --suite analysis
pnpm eval:agent --case <id>
pnpm eval:agent:report <run-directory>
```

Require an explicit live-run confirmation flag. Print model, reasoning, case count, max steps, and max cost before sending.

Default local config may use:

```text
model: openai/gpt-5.6-luna
reasoning: medium
```

but all settings remain configurable and model capabilities are checked at runtime.

## Eval cases

Generate evals from enabled example/corpus scenarios where possible. Include:

- identify calibration/metadata;
- create ROI and measure;
- threshold/count known particles;
- watershed touching particles;
- filter by size/circularity;
- FFT and report known spacing;
- AFM leveling and roughness;
- stack alignment/drift;
- create/typecheck/test a script;
- select the right UI/result surface;
- project replay;
- refusal/approval/cancellation/secret tests.

## Graders

Deterministic:

- final workspace hash/commands;
- exact or tolerated numerical results;
- units;
- required/forbidden tools;
- permission/approval compliance;
- no secret leakage;
- step/token/latency/cost budgets;
- object references and project identity.

Human rubric only for clarity, uncertainty, and scientific explanation.

Store redacted JSONL traces locally. Do not store API keys, raw local file bytes, uncontrolled metadata, or hidden reasoning.

## CI separation

- deterministic fake-model evals remain in normal CI;
- live eval scripts fail closed if invoked without the explicit local env and confirmation;
- CI config asserts that no OpenRouter key or live test command is present;
- document how to run and compare local eval reports.

## Final integrated audit

Audit:

- public PureJsImage imports;
- package dependency boundaries;
- Worker/script/agent lifecycle and cancellation;
- memory/range budgets;
- project/script/plugin identity and replay;
- credential/redaction paths;
- corpus licenses/integrity;
- numerical operation coverage;
- accessibility/keyboard/visual stability;
- bundle/code splitting, especially editor, QuickJS, and agent dependencies;
- all action descriptors and tool schemas;
- stale docs/placeholders/disabled controls.

Run the complete quality, corpus, browser, sandbox, fake-agent, visual, and performance gates. Produce `docs/READINESS_REPORT.md` with completed capabilities, known limitations, benchmark/eval commands, and prioritized findings from future scientist use—not speculative framework work.
