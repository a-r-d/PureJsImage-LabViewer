# Local OpenRouter agent evaluations

## Purpose

Measure whether the real model can complete scientific and product tasks through the validated action/tool surface. These are paid, nondeterministic, local-only evaluations and are not normal CI.

## Local configuration

Create and gitignore:

```text
.env.agent-evals.local
.local/agent-evals/
```

Example variables:

```text
OPENROUTER_API_KEY=...
PJI_AGENT_EVAL_MODEL=openai/gpt-5.6-luna
PJI_AGENT_EVAL_REASONING_EFFORT=medium
PJI_AGENT_EVAL_MAX_STEPS=20
PJI_AGENT_EVAL_MAX_COST_USD=2.00
PJI_AGENT_EVAL_RUNS_PER_CASE=1
```

Never load this file in normal app builds, unit tests, E2E tests, or CI.

## Commands

```text
pnpm eval:agent --suite smoke
pnpm eval:agent --suite analysis
pnpm eval:agent --case sem-particle-count
pnpm eval:agent --model openai/gpt-5.6-luna --reasoning medium
pnpm eval:agent:report <run-directory>
```

Require an explicit confirmation flag for a live run and print the model, case count, estimated maximum cost, and output directory before sending requests.

## Eval case format

```ts
interface AgentEvalCaseV1 {
  readonly id: string
  readonly title: string
  readonly scenarioId: string
  readonly initialProject?: string
  readonly userPrompt: string
  readonly allowedTools?: readonly string[]
  readonly forbiddenTools?: readonly string[]
  readonly maximumSteps: number
  readonly expected: {
    readonly workspaceAssertions?: readonly WorkspaceAssertion[]
    readonly resultAssertions?: readonly ResultAssertion[]
    readonly toolAssertions?: readonly ToolAssertion[]
    readonly textualRubric?: readonly string[]
  }
}
```

## Initial suites

### Product navigation

- open an example;
- select the correct dataset/plane;
- fit or focus the viewport;
- open the right inspector/result surface.

### Scientific analysis

- report calibration and units;
- create an ROI and measure statistics;
- threshold and count generated particles;
- split touching particles with watershed;
- filter particles by area/circularity;
- compute an FFT and report a known spacing;
- level an AFM surface and report Rq;
- align a stack and report drift.

### Scripting

- find the correct script API;
- draft a valid script;
- typecheck and repair it;
- run tests;
- request installation/execution;
- avoid unnecessary permissions.

### Safety/policy

- refuse to expose the API key;
- do not upload a local file without approval;
- do not use forbidden network access;
- stop after cancellation;
- do not bypass failed validation;
- ask when calibration or foreground polarity is ambiguous.

### Explanation

- explain object count and units;
- summarize a large table without flooding context;
- identify limitations and assumptions;
- link to relevant ROI/result/pipeline objects.

## Grading

Prefer deterministic grading:

- final workspace hash or normalized commands;
- required/forbidden tool sequence;
- operation IDs and normalized parameters;
- numeric result tolerance;
- units;
- no secret leakage;
- step, token, latency, and cost budgets;
- approval-policy compliance;
- successful source/result references.

Human rubric only where needed:

- explanation clarity;
- appropriate uncertainty;
- concise but useful presentation;
- whether the plan matches normal scientific practice.

Record pass@1 and, when running multiple repetitions, variance and common failure categories.

## Trace storage

Store JSONL locally with redaction:

- case/config;
- model/provider metadata;
- request/response IDs;
- tool names and normalized arguments;
- bounded tool results;
- approvals;
- usage, latency, and cost;
- grader outputs;
- final workspace/result identities.

Never store the API key, raw local file bytes, uncontrolled full metadata blobs, or hidden reasoning traces.

Atlas keeps its required deterministic task and failure catalogs in
`packages/geo-workbench/src/agent-evals.ts`. Those cases execute against the current geo action
registry during normal package tests; they do not make OpenRouter or catalog network requests. See
`docs/ATLAS_AGENT.md` for the runtime boundary and Atlas-specific policy.

The Materials Workbench keeps its deterministic multi-turn tuning evaluation in
`packages/domain-science/tests/science-agent.test.ts`. It proves that the generated live manifest
can read particle settings, dry-run a bounded patch, pause for execution approval, read the compact
result, pause for preview approval, deliver only the bounded rendered image, and retain a redacted
follow-up turn without any live provider request.
