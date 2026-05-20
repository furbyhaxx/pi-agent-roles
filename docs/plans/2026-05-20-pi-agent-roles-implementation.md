# pi-agent-roles Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build the full `pi-agent-roles` MVP from the draft: session-scoped role discovery, switching, tool/skill policy, prompt/context injection, UI manager, fancy-editor integration, bundled `role-creator` skill, docs, and tests.

**Architecture:** Keep the extension source in `src/` and split it into small modules for config/discovery, runtime state, prompt building, role policy evaluation, UI, and color caching. Persist branch-aware role state with custom session entries, inject stable per-prompt role info in `before_agent_start`, inject live role context in `context`, and enforce runtime tool policy in `tool_call` plus a dedicated `role:switch` tool.

**Tech Stack:** TypeScript via pi extension loader, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`, Node.js built-ins.

---

### Task 1: Define types, constants, and test targets

**Files:**
- Create: `src/types.ts`
- Modify later: `src/index.ts`
- Test: `tests/config.test.ts`, `tests/discovery.test.ts`, `tests/state.test.ts`, `tests/prompt.test.ts`, `tests/tool-policy.test.ts`, `tests/role-display.test.ts`

**Step 1: Write failing tests**
- Add failing assertions for role ids, activation modes, policy actions, persisted state shape, and emitted display payload shape.

**Step 2: Run tests to verify they fail**
- Run: `npm run test:unit`
- Expected: missing-module / missing-export failures.

**Step 3: Write minimal implementation**
- Add shared types/constants for role files, resolved roles, state entries, command names, and event names.

**Step 4: Run tests again**
- Run: `npm run test:unit`
- Expected: type import failures move to the next missing module.

### Task 2: Implement settings loading and role discovery

**Files:**
- Create: `src/config.ts`, `src/discovery.ts`, `src/colors.ts`
- Test: `tests/config.test.ts`, `tests/discovery.test.ts`

**Step 1: Write failing config/discovery tests**
- Cover default roots, `roles.roots` expansion, project-over-global override, `userSwitchMode` fallback, recursive `*.md` discovery, collision handling, fallback role creation, and color resolution/cache behavior.

**Step 2: Run tests to verify RED**
- Run: `tsx tests/config.test.ts && tsx tests/discovery.test.ts`
- Expected: failures about missing loaders / wrong outputs.

**Step 3: Write minimal implementation**
- Load settings with `SettingsManager`-style raw global/project reads.
- Discover and parse role markdown files with frontmatter validation.
- Resolve explicit colors, aliases, and generated cached fallback colors under `${PI_CODING_AGENT_DIR}`.

**Step 4: Verify GREEN**
- Re-run the same test commands and confirm both pass.

### Task 3: Implement branch-aware runtime state and prompt/context generation

**Files:**
- Create: `src/state.ts`, `src/prompt.ts`
- Test: `tests/state.test.ts`, `tests/prompt.test.ts`

**Step 1: Write failing tests**
- Cover restore order, branch reconstruction, sticky lock handling, pending user switch behavior, queued reminder handling, Roles section formatting, live `<role-state>` injection, and hidden reminders.

**Step 2: Verify RED**
- Run: `tsx tests/state.test.ts && tsx tests/prompt.test.ts`
- Expected: failures for missing reconstruction/build helpers.

**Step 3: Write minimal implementation**
- Reconstruct current branch state from custom entries.
- Serialize role changes to custom entries.
- Build the stable system-prompt Roles section and live role-state XML blocks.

**Step 4: Verify GREEN**
- Re-run the state/prompt tests until they pass cleanly.

### Task 4: Implement tool/skill policy evaluation and `role:switch`

**Files:**
- Create: `src/policy.ts`, `src/tool.ts`
- Modify: `src/state.ts`, `src/prompt.ts`
- Test: `tests/tool-policy.test.ts`

**Step 1: Write failing tests**
- Cover tool glob matching, allow/ask/deny behavior, visible-tool filtering, skill visibility filtering, agent-switchable role lists, structured error results, sticky-lock blocking, and no-op same-role switches.

**Step 2: Verify RED**
- Run: `tsx tests/tool-policy.test.ts`
- Expected: failures for missing policy logic/tool implementation.

**Step 3: Write minimal implementation**
- Implement policy matchers.
- Implement runtime tool filtering and `role:switch` result details.
- Forward temperature overrides in `before_provider_request` on a best-effort basis.

**Step 4: Verify GREEN**
- Re-run the tool-policy test until it passes.

### Task 5: Implement commands, responsive manager UI, editor integration, and extension wiring

**Files:**
- Create: `src/ui.ts`, `src/index.ts`
- Test: `tests/role-display.test.ts`

**Step 1: Write failing tests**
- Cover active-role event emission/clearing, wide vs narrow manager mode selection helpers, and status/widget fallback decisions.

**Step 2: Verify RED**
- Run: `tsx tests/role-display.test.ts`
- Expected: failures for missing event/UI helpers.

**Step 3: Write minimal implementation**
- Register `/role:manage` and `/role:unstick`.
- Register the cycle shortcut.
- Implement the responsive manager: two-pane wide, compact modal narrow.
- Wire session lifecycle, `resources_discover`, `before_agent_start`, `context`, `before_provider_request`, `tool_call`, `turn_end`, `session_tree`, `session_shutdown`.
- Emit `pi-agent-roles:active-role` and manage widget fallback below the editor.

**Step 4: Verify GREEN**
- Re-run `tsx tests/role-display.test.ts`.

### Task 6: Bundle the skill, docs, and package polish

**Files:**
- Create: `skills/role-creator/SKILL.md`, `README.md`
- Modify: `CHANGELOG.md`, `package.json`

**Step 1: Write/read tests or validation targets first**
- Define the role-creator skill trigger/contents target and README config examples.

**Step 2: Implement**
- Add the bundled `role-creator` skill and expose it only through `resources_discover`.
- Write README install/config/role file examples and wireframe notes.
- Update `CHANGELOG.md`.

**Step 3: Validate**
- Run: `pi --no-skills --skill ./skills/role-creator`
- Expected: skill loads without frontmatter warnings.

### Task 7: Full verification and live smoke test

**Files:**
- Modify as needed based on failures.

**Step 1: Run automated verification**
- Run: `npm test`
- Run: `npm run typecheck`

**Step 2: Run live extension smoke tests**
- Start: `pi -e ./src/index.ts`
- Exercise: `/role:manage`, role switch, `/role:unstick`, widget fallback, and a prompt that triggers `role:switch` visibility rules.

**Step 3: Verify final status before claiming done**
- Re-run the exact commands used for verification and read the output.

**Step 4: Commit**
- Stage only source/docs/tests/package files.
- Commit with a conventional message describing what was added.
