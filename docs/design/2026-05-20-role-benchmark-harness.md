# Role Benchmark Harness — Design

Status: Draft for review
Owner: pi-agent-roles
Date: 2026-05-20

## 1. Problem

`pi-agent-roles` exposes `role_switch` as an agent-callable tool, but in real
usage across multiple projects the agent rarely (or never) reaches for it on
its own, even when the task obviously warrants a role switch (debug, review,
research, etc.).

Without a way to measure this, we can't tell whether the cause is:

1. `role_switch` not actually being in the active tool set for the starting role.
2. The tool description being too weak/abstract.
3. The system prompt's role guidance being too buried, too verbose, or too vague.
4. The model itself being non-compliant (model-specific behavior).
5. The agent-switchable role list being missing/empty for the starting role.
6. Too many roles competing for attention ("role-pack overload").

A benchmark harness lets us turn this from vibes into numbers we can optimize.

## 2. Goals

- Measure, per (scenario, model, role-pack, prompt-variant):
  - **Switch trigger rate** — did the agent call `role_switch` at all?
  - **Correct target role** — did it pick the right role?
  - **Downstream behavior** — after switching, did tool usage / prompt content /
    output actually reflect the new role policy?
- Surface structural failures fast: `role_switch` missing from tool set,
  guidance missing from system prompt, etc.
- Be reproducible and committable (regression suite over time).
- Be cheap to extend with new scenarios.

## 3. Non-goals

- No general agent-quality benchmark. We only score role-related behavior.
- No live TUI dashboard in v1.
- No CI gating in v1 — first we want signal, then we decide thresholds.

## 4. Location & invocation

- Lives in the existing `pi-agent-roles` repo under `benchmarks/`.
- Standalone CLI entry point that drives pi **programmatically via the SDK**
  (`createAgentSession`), not by spawning the `pi` binary as a subprocess.
  Rationale: faster, deterministic environment, easy to capture tool calls and
  provider payloads via the same extension event hooks we already use in tests.
- Invocation:
  - `npm run bench` — full default matrix, default scenarios.
  - `npm run bench -- --models openai-codex/gpt-5.4:high --scenarios debug-failing-test`
  - `bin/pi-roles-bench` for direct CLI use after `npm link` / `npm i -g`.

## 5. Default model matrix

Pulled from `~/.pi/agent/allowed-models.md`, Tier-1 + Tier-2, with the user's
requested `openai-codex/gpt-5.5` → `openai-codex/gpt-5.4:high` swap.

| Tier | Provider          | Model                 | Thinking |
| ---- | ----------------- | --------------------- | -------- |
| 1    | openai-codex      | gpt-5.4               | high     |
| 1    | github-copilot    | claude-opus-4.7       | medium   |
| 1    | deepseek          | deepseek-v4-pro       | high     |
| 1    | github-copilot    | gpt-5.5               | high     |
| 2    | openai-codex      | gpt-5.3-codex         | high     |
| 2    | github-copilot    | claude-sonnet-4.6     | high     |
| 2    | github-copilot    | gemini-3.1-pro-preview| high     |
| 2    | opencode          | big-pickle            | high     |

Matrix is configurable via `--models` flag and a `benchmarks/matrix.json`.
The default matrix is a constant exported from `benchmarks/src/matrix.ts` so
it's diffable in git.

## 6. Scenarios

### Format

Each scenario is a markdown file in `benchmarks/scenarios/*.md`:

```markdown
---
id: debug-failing-test
title: Debug a failing test
startingRole: builder
expectedRole: debugger
allowedRoles: [debugger, developer, reviewer]
expectedToolsAfterSwitch: [bash, read, grep]
expectedSkills: []
maxAssistantTurns: 12        # generous default; will tighten
maxToolCallsPerTurn: 8
wallClockMs: 180000
notes: |
  The agent should recognize this is a debugging task and call
  role_switch(role="debugger") within the first 1-2 assistant turns.
---

I added a new caching layer and now `npm test` fails with:

```
TypeError: Cannot read properties of undefined (reading 'get')
   at CacheLayer.lookup (src/cache.ts:42)
```

Please figure out what is going wrong.
```

### v1 seed pack

1. `debug-failing-test.md` → expected `debugger`
2. `review-diff.md` → expected `reviewer`
3. `brainstorm-feature.md` → expected `brainstormer`
4. `research-task.md` → expected `researcher`

Each scenario is paired with a `fixtures/` directory if it needs files on
disk (the debug scenario needs a fake failing project, the review scenario
needs a diff, etc.).

## 7. Evaluation

### 7.1 Deterministic rubric (primary)

Per (scenario, model, variant) run, compute:

- `switched: boolean` — was `role_switch` called?
- `switchTurn: number | null` — index of the first call.
- `targetRole: string | null` — argument passed.
- `targetCorrect: boolean` — `targetRole === expectedRole` (or ∈ allowedRoles).
- `postSwitchToolUsage: string[]` — tools the agent called after switching.
- `postSwitchToolPolicyViolations: string[]` — tools called that the new role
  denies (caught via tool-exposure audit).
- `systemPromptContainsSwitchGuidance: boolean` — sanity check.
- `roleSwitchInToolSet: boolean` — sanity check before the run even starts.

A scenario is **PASS** iff: switched && targetCorrect && no policy violations.

### 7.2 LLM-as-judge (fallback on failures only)

When the deterministic rubric returns FAIL, we send the transcript +
scenario expectations to `deepseek/deepseek-v4-pro` with thinking=high and
ask for a structured JSON verdict explaining *why* it failed:

```json
{
  "rootCause": "did_not_switch | wrong_role | too_late | tool_violation | other",
  "evidence": "quoted snippet from transcript",
  "suggestedFix": "free-form short string"
}
```

The judge never overrides the rubric's PASS/FAIL — it only annotates fails so
we can categorize failure modes when we aggregate.

Rationale: deepseek-v4-pro picked because its huge context fits whole
transcripts, it's cheap, and it's strong analytically. The choice is a CLI
flag in case we want to swap it.

## 8. Probes (run alongside scenarios)

These run once per (model, role-pack) combo, independent of scenario content:

- **Tool exposure audit** — Start a session in the default role, assert
  `role_switch` is in `getActiveToolNames()`. Catches the “tool was filtered
  out” class of bug in <1s without a model call.
- **System prompt audit** — Render the system prompt for each
  agent-switchable role, assert it contains:
  - the `<role-state>` block
  - `Use \`role_switch\` only when another listed role is a better fit.`
  - the list of agent-switchable roles with `description` text
  Flag missing pieces in the report.
- **Prompt-variant A/B** — Run the seed pack across N system-prompt phrasings
  of the role-switch guidance. v1 ships 2–3 variants in
  `benchmarks/variants/*.md`, each a stand-alone replacement snippet.
- **Role-pack ablation** — Run the seed pack with two role-pack sizes:
  - `minimal` (only the expected role + builder)
  - `full` (all example roles)
  Surfaces whether "too many roles" hurts compliance.

## 9. Budget

Initial defaults are **generous** so we don't accidentally label slow models
as non-compliant before we know what real behavior looks like. After the
first clean run we tighten.

- `maxAssistantTurns`: 12
- `maxToolCallsPerTurn`: 8
- `wallClockMs`: 180_000 (3 min) per (scenario, model, variant)
- `concurrency`: 1 by default (we care about per-run reproducibility, not speed)

All four are overridable per-scenario via frontmatter and globally via CLI
flags.

## 10. Outputs

Every run writes to `benchmarks/runs/<ISO-timestamp>__<short-hash>/`:

- `summary.md` — committable matrix table:
  ```
  | scenario              | model                          | variant  | switched | correct | turns | verdict |
  | --------------------- | ------------------------------ | -------- | -------- | ------- | ----- | ------- |
  | debug-failing-test    | openai-codex/gpt-5.4:high      | default  | yes      | yes     | 1     | PASS    |
  | debug-failing-test    | github-copilot/claude-opus-4.7 | default  | no       | n/a     | 12    | FAIL    |
  | ...
  ```
  Plus aggregate switch-rate / accuracy per (model, variant).
- `results.jsonl` — one line per (scenario, model, variant) for machine consumption.
- `transcripts/<scenario>__<model>__<variant>.md` — full assistant turns +
  tool calls + role-state changes for every run, for failure inspection.
- `probes.md` — tool-exposure + system-prompt audit results.

`benchmarks/runs/latest` is a symlink to the most recent run.

## 11. Code layout

```
pi-agent-roles/
  benchmarks/
    README.md
    bin/pi-roles-bench.ts          # CLI entry, parses flags, dispatches
    src/
      cli.ts                       # argv parsing + main()
      runner.ts                    # orchestrates (scenario × model × variant)
      session.ts                   # createAgentSession wrapper, captures events
      probes.ts                    # tool exposure + system prompt audits
      rubric.ts                    # deterministic scoring
      judge.ts                     # LLM-as-judge wrapper
      report.ts                    # writes summary.md + results.jsonl
      transcript.ts                # human-readable transcript dump
      matrix.ts                    # default model matrix constant
      scenarios.ts                 # frontmatter loader + validator
      types.ts                     # shared types
    scenarios/
      debug-failing-test.md
      review-diff.md
      brainstorm-feature.md
      research-task.md
      fixtures/                    # optional per-scenario file trees
    variants/
      default.md
      stronger-nudge.md
      laconic.md
    runs/                          # gitignored except .gitkeep + README
```

## 12. Open questions for review

1. **Concurrency** — Default to 1 for reproducibility, but should we allow
   `--concurrency N` for the impatient? Tradeoff: makes wall-clock budgets
   meaningless if N > 1.
2. **Auth** — Driving the SDK means each provider needs creds resolvable
   through pi's normal auth path. Should the harness fail loudly if a
   matrix model has no credentials, or skip silently with a warning? I lean
   "fail loudly per default, `--skip-unauth` to skip".
3. **Scenario fixtures** — Should fixtures be set up in a tmpdir per run
   (clean, slow) or once per benchmark process (faster, risk of cross-test
   contamination)? I lean per-run tmpdir.
4. **Variants in v1** — Worth shipping 2–3 prompt variants from day one, or
   start with just the current `default` and add variants after the first
   baseline run?
5. **CHANGELOG / version** — A benchmark harness landing is meaningful; do
   we bump to `0.3.0` when it lands, or keep it under `0.2.x` until we have
   first baseline results?

## 13. Out of scope (explicit non-goals for v1)

- Continuous benchmarking in CI.
- Cost tracking / token accounting beyond what the SDK already reports.
- Visualization beyond markdown tables.
- Benchmarking non-role aspects (skill discovery, fancy-editor, etc).
- Replay of historical sessions.

## 14. Handoff

If approved, hand to a planner role to produce a step-by-step implementation
plan (probably in 3–4 PR-sized chunks: scaffold + probes; deterministic
rubric + report; LLM judge + variants; ablation + tighten budgets).
