# pi-agent-roles v2 Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Ship `pi-agent-roles` 2.0.0 with role-scoped skill subsystem (own `skill` tool, fuzzy search, compaction-resistant active block), restructured `skills`/`tools` role schema, system-prompt template takeover, and an improved `ask` UX with first-time primary-arg picker.

**Architecture:** Three new subsystems wired into existing extension lifecycle:
1. **Schema v2** — `discovery.ts`/`types.ts` parse a new nested shape; old shapes hard-fail with diagnostics. `policy.ts` compiles `(inherit, allow|ask|deny|hidden, required|optional|hidden)` per role.
2. **Skill subsystem** — new `skill` tool (`search|activate|deactivate|info`), in-memory + `appendEntry`-persisted active set, and a `before_agent_start` step that calls pi's exported `buildSystemPrompt({ ...opts, skills: [] })` and expands a user-overridable template containing `{{availableSkills}}`, `{{activeSkills}}`, role state, etc.
3. **Ask UX** — `tool_call` handler that uses per-session approvals, a primary-arg picker for unknown tools, and persists picks to `~/.pi/agent/settings.json` (default) or `.pi/settings.json`.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` ExtensionAPI (`registerTool`, `before_agent_start`, `tool_call`, `appendEntry`, `ctx.ui.select`, `ctx.ui.confirm`, `buildSystemPrompt`), Typebox for tool schemas, zero new runtime deps (handcrafted BM25-lite scorer + minimal mustache-ish template engine).

**Branching:** Work in a dedicated worktree `../pi-agent-roles-v2` off `main`. Commit per task. Tag `v2.0.0` at the end.

---

## Phase 0 — Worktree, branch, version bump

### Task 0.1: Create worktree and branch

**Files:** none yet (filesystem op).

**Step 1:** From the repo root, list current state.

Run: `cd /home/arnold/.pi/agent/custom-extensions/pi-agent-roles && git status && git branch --show-current`
Expected: clean tree on `main` (or note any pending TODOS.md change).

**Step 2:** Create a worktree using the using-git-worktrees skill conventions.

Run:
```
git worktree add -b v2-rescope ../pi-agent-roles-v2
cd ../pi-agent-roles-v2
```
Expected: new worktree at `../pi-agent-roles-v2` checked out on `v2-rescope`.

**Step 3:** Install deps in the worktree.

Run: `npm install`
Expected: lockfile resolves, `node_modules/` populated.

**Step 4:** Commit a baseline marker so subsequent diffs are clean.

```
git commit --allow-empty -m "chore: start v2 rescope work"
```

---

### Task 0.2: Bump to a pre-release version

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

**Step 1:** Set version to `2.0.0-dev.0` in `package.json`.

```json
"version": "2.0.0-dev.0",
```

**Step 2:** Prepend a `## 2.0.0-dev.0 — Unreleased` section to `CHANGELOG.md` with a placeholder `### Breaking` heading. Real entries are filled in per task.

**Step 3:** Commit.

```
git add package.json CHANGELOG.md
git commit -m "chore(release): begin 2.0.0-dev.0"
```

---

## Phase 1 — Schema v2 (hard switch)

### Task 1.1: New type definitions

**Files:**
- Modify: `src/types.ts`

**Step 1:** Add new exported types (keep existing legacy types until the parser switches; mark them `@deprecated` in TSDoc):

```typescript
export interface SkillsRootsConfig {
	inherit: boolean;
	dirs: string[];
}

export interface RoleSkillsConfig {
	roots: SkillsRootsConfig;
	inheritLoaded: boolean;
	required: string[];   // glob patterns, evaluated against discovered skill names
	optional: string[];
	hidden: string[];
	rules: SkillPolicyRule[]; // compiled last-match-wins view (kept for policy.ts)
}

export interface RoleToolsConfig {
	inherit: boolean;
	allow: string[];
	ask: string[];
	hidden: string[];
	rules: ToolPolicyRule[]; // compiled last-match-wins view
}
```

**Step 2:** Change `ResolvedRole`:

```typescript
export interface ResolvedRole {
	// ...everything before `tools`
	tools: RoleToolsConfig;
	skills: RoleSkillsConfig;
	hasExplicitSkills: boolean; // remains, set by parser
	// ...rest unchanged
}
```

**Step 3:** Run `npm run typecheck`. Expected: errors in `discovery.ts`, `policy.ts`, `prompt.ts`, `ui.ts`, `index.ts` because they consume the old shape. That is the intended starting point.

**Step 4:** Commit.

```
git add src/types.ts
git commit -m "feat(types)!: introduce nested skills/tools role config shape"
```

---

### Task 1.2: Write failing parser tests for the new shape

**Files:**
- Create: `tests/discovery-v2.test.ts`

**Step 1:** Create the test scaffolding using the same patterns as `tests/discovery.test.ts` (tiny in-memory temp dirs + `discoverRoles`). Tests:

1. `parses skills.roots.inherit=false with dirs and required/optional/hidden globs`
2. `parses tools.inherit=false with allow/ask/hidden lists`
3. `rejects legacy skills shorthand array` (must produce a `warning` diagnostic mentioning migration, and role is dropped)
4. `rejects legacy skills mapping`
5. `rejects legacy tools mapping`
6. `defaults: missing skills block produces roots.inherit=true, inheritLoaded=true, empty lists`
7. `defaults: missing tools block produces inherit=true, no rules`

For each, write the complete `it(...)` block with helper to spawn a temp role file. Borrow the helper from `discovery.test.ts` and import it.

**Step 2:** Run only the new test:

```
npx tsx tests/discovery-v2.test.ts
```
Expected: all 7 tests FAIL (compilation or assertion).

**Step 3:** Commit (failing tests are expected to land first).

```
git add tests/discovery-v2.test.ts
git commit -m "test(discovery): scaffold failing tests for schema v2"
```

---

### Task 1.3: Implement the new parser

**Files:**
- Modify: `src/discovery.ts`

**Step 1:** Replace `normalizeToolRules` with `normalizeToolsConfig(value, diagnostics, path): RoleToolsConfig`:

- Reject `undefined` only when missing → defaults `{ inherit: true, allow: [], ask: [], hidden: [], rules: [{ pattern: "*", action: "allow" }] }`.
- Reject array shorthand and `Record<string, ToolPolicyAction>` mapping by pushing a `warning` diagnostic: `"legacy tools shape is no longer supported — see docs/migration.md"` and returning `undefined` so the role is dropped.
- Accept nested object: read `inherit?: boolean (default true)`, and the three arrays `allow`, `ask`, `hidden`.
- Compile `rules`:
  - Base: `inherit ? { pattern: "*", action: "allow" } : { pattern: "*", action: "deny" }`
  - Then each `allow` entry as `{pattern, action: "allow"}`, each `ask` as `"ask"`, each `hidden` as `"deny"`.
  - Order matters — last match wins.

**Step 2:** Replace `normalizeSkillRules` with `normalizeSkillsConfig(value, diagnostics, path): { config: RoleSkillsConfig; hasExplicit: boolean }` analogously:

- Defaults: `{ roots: { inherit: true, dirs: [] }, inheritLoaded: true, required: [], optional: [], hidden: [], rules: [{pattern:"*", action:"optional"}] }`.
- Reject array shorthand and `Record<string, SkillPolicyAction>` mapping with diagnostic.
- Accept nested object: `roots: { inherit?: boolean (true), dirs?: string[] (empty) }`, `inherit_loaded?: boolean (true)`, three arrays.
- Path expansion for `roots.dirs` reuses `resolveConfiguredPath` from `config.ts` — re-export it if needed and call it with the directory containing the role file (or `cwd` — pick role file dir for project-local resolution; document in README).
- Compile `rules`:
  - Base: `{ pattern: "*", action: "optional" }`
  - Then each `optional` entry as `"optional"`, each `hidden` as `"hidden"`, each `required` as `"required"`.

**Step 3:** Update `parseRoleFile` to call the two new normalizers and store the new shapes on `ResolvedRole`. Update `fallbackRole` to use the new shape.

**Step 4:** Run typecheck and the new test:

```
npm run typecheck
npx tsx tests/discovery-v2.test.ts
```
Expected: typecheck passes (with new errors in policy/prompt/ui/index — those follow), discovery-v2 tests PASS.

**Step 5:** Commit.

```
git add src/discovery.ts src/types.ts
git commit -m "feat(discovery): parse nested skills/tools role config (BREAKING)"
```

---

### Task 1.4: Update `policy.ts` to consume new shapes

**Files:**
- Modify: `src/policy.ts`
- Modify: `tests/tool-policy.test.ts` (update fixtures, do not change assertions semantics where preserved)

**Step 1:** `matchToolPolicy` and `matchSkillPolicy` read from `role.tools.rules` and `role.skills.rules`. The signatures stay the same.

**Step 2:** `filterVisibleTools` adds the `hidden` short-circuit: a tool whose name is in `role.tools.hidden` (literal match or glob) is filtered out before the policy check.

**Step 3:** `summarizeRole` reads `role.skills.required` and `role.skills.optional` directly instead of filtering `rules`.

**Step 4:** Update the existing `tests/tool-policy.test.ts` fixtures to construct the new shape (helper `mkRole(...)` to share between tests).

**Step 5:** Run:

```
npm run typecheck
npx tsx tests/tool-policy.test.ts
```
Expected: typecheck clean for this file's imports; tool-policy tests PASS.

**Step 6:** Commit.

```
git add src/policy.ts tests/tool-policy.test.ts
git commit -m "refactor(policy): consume nested skills/tools shape"
```

---

### Task 1.5: Migrate bundled example roles

**Files:**
- Modify: all files under `examples/roles/*.md`
- Modify: `tests/example-roles.test.ts`

**Step 1:** Rewrite every example role to the v2 shape. The legacy patterns translate as:

- `skills: [a, b]` → `skills: { required: [a, b] }`
- `skills: { a: required, b: hidden }` → `skills: { required: [a], hidden: [b] }`
- `tools: [a, b]` → `tools: { inherit: false, allow: [a, b] }`
- `tools: { bash: ask }` → `tools: { ask: [bash] }`

Audit each file in `examples/roles/` and rewrite consistently. Where a role used `*` globs, port them as-is into the array.

**Step 2:** Update `tests/example-roles.test.ts` assertions to expect the new nested shape on `ResolvedRole`.

**Step 3:** Run:

```
npm run typecheck
npx tsx tests/example-roles.test.ts
```
Expected: PASS.

**Step 4:** Commit.

```
git add examples/roles tests/example-roles.test.ts
git commit -m "refactor(examples): migrate bundled roles to v2 schema"
```

---

### Task 1.6: Update everything that still references the old shapes

**Files:**
- Modify: `src/prompt.ts`, `src/ui.ts`, `src/index.ts`

**Step 1:** Search and update each reference:

```
git grep -n "role.skills" src/
git grep -n "role.tools" src/
git grep -n "hasExplicitSkills" src/
```
Replace `role.skills.filter(...)` patterns with the new array accessors (`role.skills.required` etc.). Replace `role.tools.filter(...)` similarly.

**Step 2:** In `index.ts` `skillLists(...)`, simplify:

```typescript
function skillLists(role: ResolvedRole, skills: readonly Skill[]): { required: string[]; optional: string[] } {
	return {
		required: role.skills.required,
		optional: role.skills.optional,
	};
}
```

**Step 3:** Run the full unit suite:

```
npm run test:unit
```
Expected: every test PASSES.

**Step 4:** Commit.

```
git add src/
git commit -m "refactor: align prompt/ui/index with v2 role shape"
```

---

## Phase 2 — System prompt template takeover

### Task 2.1: Tiny template engine

**Files:**
- Create: `src/template.ts`
- Create: `tests/template.test.ts`

**Step 1 (test first):** Write `tests/template.test.ts` with cases:

1. `renderTemplate("Hello {{name}}", { name: "Pi" })` → `"Hello Pi"`
2. `{{#each items}}- {{name}}\n{{/each}}` with `items: [{name:"a"},{name:"b"}]` → `"- a\n- b\n"`
3. `{{#if flag}}on{{else}}off{{/if}}` with `flag: false` → `"off"`
4. Missing variables render as empty string.
5. HTML-escaping is NOT applied (templates render system prompt text, not HTML).

Run: `npx tsx tests/template.test.ts` → FAIL.

**Step 2:** Implement `src/template.ts` as a simple recursive descent renderer supporting:

- `{{var.path}}` — dot-path lookup, fallback `""`.
- `{{#each path}}...{{/each}}` — iterates arrays, sets the current object as the scope (also exposes `this` and `@index`).
- `{{#if path}}...{{else}}...{{/if}}` — truthy check.
- Literal `\{{` to escape the opening braces.

Keep it under ~150 lines. No external deps.

**Step 3:** Run the test, expect PASS. Run `npm run typecheck`.

**Step 4:** Commit.

```
git add src/template.ts tests/template.test.ts
git commit -m "feat(template): add minimal mustache-style template engine"
```

---

### Task 2.2: Default system-prompt template

**Files:**
- Create: `templates/system-prompt-template.md`
- Modify: `package.json` `files` to include `templates/`

**Step 1:** Author the default template. Skeleton:

```
{{builtinSystemPrompt}}

## Role
Current role: `{{role.name}}` ({{role.label}})
{{#if role.triggerDescription}}Guidance: {{role.triggerDescription}}{{/if}}

{{#if role.body}}{{role.body}}{{/if}}

{{#if availableSkills.length}}
## Skills (in scope for this role)
Use the `skill` tool to search, activate, deactivate, or inspect them.
{{#each availableSkills}}- `{{name}}` — {{description}}
{{/each}}
{{/if}}

{{#if activeSkills.length}}
## Active Skill Content
{{#each activeSkills}}
<active-skill name="{{name}}" path="{{filePath}}">
{{body}}
</active-skill>
{{/each}}
{{/if}}

{{state}}
```

**Step 2:** Add `"templates"` to `package.json` `files` array. Run `npm pack --dry-run` to confirm it ships.

**Step 3:** Commit.

```
git add templates package.json
git commit -m "feat(prompt): bundle default system-prompt template"
```

---

### Task 2.3: Template loader with override resolution

**Files:**
- Create: `src/template-loader.ts`
- Create: `tests/template-loader.test.ts`

**Step 1 (test first):** Tests assert lookup precedence:

1. Project `.pi/roles/system-prompt-template.md` wins if present.
2. Else global `~/.pi/agent/roles/system-prompt-template.md` (via `PI_CODING_AGENT_DIR`).
3. Else bundled `<package>/templates/system-prompt-template.md`.
4. Result is the raw template string.
5. Caching: same path resolves once until `invalidate()` is called.

Run → FAIL.

**Step 2:** Implement `loadSystemPromptTemplate(cwd: string, agentDir?: string): string` with the lookup chain and a module-level `Map` cache keyed by resolved path. Expose `invalidateSystemPromptTemplateCache()`.

**Step 3:** Run the test → PASS.

**Step 4:** Commit.

```
git add src/template-loader.ts tests/template-loader.test.ts
git commit -m "feat(prompt): system-prompt template loader with overrides"
```

---

### Task 2.4: Wire the template into `before_agent_start`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/prompt.ts`

**Step 1:** Import `buildSystemPrompt` from `@earendil-works/pi-coding-agent`. In the existing `before_agent_start` handler, replace the current `filterHiddenSkillsFromPrompt(...)` path with:

```typescript
const baseOptions = {
	...event.systemPromptOptions,
	skills: [], // we render our own catalog
};
const builtin = buildSystemPrompt(baseOptions);

const inScopeSkills = filterSkillsForRole(lastKnownSkills, role); // returns Skill[]
const activeSkillBodies = readActiveSkillBodies(activeSkillState); // {name, filePath, body}[]

const tpl = loadSystemPromptTemplate(ctx.cwd);
const rendered = renderTemplate(tpl, {
	builtinSystemPrompt: builtin,
	role: {
		name: role.name,
		label: role.label,
		description: role.description,
		triggerDescription: role.triggerDescription ?? "",
		body: currentInstructions(role),
		requiredSkills: role.skills.required,
		optionalSkills: role.skills.optional,
		hiddenSkills: role.skills.hidden,
	},
	availableSkills: inScopeSkills.map((s) => ({ name: s.name, description: s.description ?? "", filePath: s.filePath })),
	activeSkills: activeSkillBodies,
	switchableRoles: getAgentSwitchableRoles(discovered.roles, role).map((r) => ({ name: r.name, label: r.label, triggerDescription: r.triggerDescription ?? "" })),
	switching: { allowed: roleSwitchAdvertised(role, state, discovered.roles) },
	state: buildRoleStateContext({ /* same args as today, body still injected via {{state}} */ }),
});

return { systemPrompt: rendered };
```

`filterSkillsForRole` lives in `src/prompt.ts` and returns the union of:
- skills whose `filePath` is under any of `role.skills.roots.dirs` when `roots.inherit === false`, otherwise every loaded skill,
- minus any whose name matches `role.skills.hidden`.

`readActiveSkillBodies` lives in `src/skill-runtime.ts` (Phase 3) — for this task, stub it to return `[]` and we'll wire the real one later.

**Step 2:** Delete or stop calling `filterHiddenSkillsFromPrompt` and `formatRolesSystemPrompt` for this code path. Keep them exported for now if tests still import them; otherwise remove.

**Step 3:** Run the unit suite. Some prompt tests may need to adapt to the new code path — update them, do not loosen them.

```
npm run test:unit
```
Expected: PASS.

**Step 4:** Commit.

```
git add src/
git commit -m "feat(prompt): take over system prompt via buildSystemPrompt + template"
```

---

## Phase 3 — Skill subsystem (`skill` tool, active block, persistence)

### Task 3.1: Active-skill runtime state

**Files:**
- Create: `src/skill-runtime.ts`
- Create: `tests/skill-runtime.test.ts`

**Step 1 (test first):** Tests for the pure functions:

1. `applyRequiredSkills(activeSet, role, allSkills)` → activates every skill matched by `role.skills.required` globs that exists in `allSkills` and is in-scope (not hidden, in role roots).
2. `applyInheritLoaded(prevActive, role)` → returns `[]` when `role.skills.inheritLoaded === false`, else `prevActive`.
3. `readActiveSkillBodies(activeSet)` reads `SKILL.md` from disk, caps per-skill to 8 KB and total to 32 KB, appends `[truncated]` marker if needed.

Run → FAIL.

**Step 2:** Implement the functions. The active set is `Array<{name:string; filePath:string; contentHash:string}>`. `readActiveSkillBodies` uses `fs.readFileSync(filePath, "utf8")`.

**Step 3:** Run the test → PASS.

**Step 4:** Commit.

```
git add src/skill-runtime.ts tests/skill-runtime.test.ts
git commit -m "feat(skills): runtime helpers for required/inherit_loaded/active body"
```

---

### Task 3.2: Persisted active-skill state via `appendEntry`

**Files:**
- Modify: `src/skill-runtime.ts`
- Modify: `src/index.ts` (`session_start`, `session_tree`)
- Modify: `src/types.ts` — add `PI_AGENT_ROLES_ACTIVE_SKILLS_ENTRY_TYPE = "pi-agent-roles-active-skills"`

**Step 1:** Add `reconstructActiveSkills(branch: SessionBranch): ActiveSkill[]` analogous to existing `reconstructRoleState`. Iterate the branch's custom entries newest-first, return the last `pi-agent-roles-active-skills` payload.

**Step 2:** In `session_start` handler (after `state = branchState(...)`), call `activeSkills = reconstructActiveSkills(ctx.sessionManager.getBranch()) ?? []`. Store in a module-scoped variable.

**Step 3:** Add `persistActiveSkills()` mirroring `persistState()` with dedup-by-stringify.

**Step 4:** Add tests under `tests/skill-runtime.test.ts` for reconstruction (build a mock branch).

**Step 5:** Run unit suite, commit.

```
git add src/ tests/skill-runtime.test.ts
git commit -m "feat(skills): persist active skill set across reloads/forks"
```

---

### Task 3.3: Fuzzy search index

**Files:**
- Create: `src/skill-search.ts`
- Create: `tests/skill-search.test.ts`

**Step 1 (test first):** Tests:

1. Builds an index from skills with name + description + body, returns top N hits ranked by BM25-lite scoring.
2. Following references: a skill body containing a relative `read ./scripts/helper.md` adds that file's content to the indexed corpus (lazy-loaded).
3. Snippet extraction: returns ~200-char snippet around the best-matching term.
4. Out-of-scope skills are not in the index when filtered.

Run → FAIL.

**Step 2:** Implement BM25-lite:

- Tokenize on `/[^A-Za-z0-9]+/`, lowercase, drop tokens length < 2.
- Per-doc term-frequency vector; per-corpus inverse-document-frequency.
- Score = Σ idf(t) · ((tf(t,d) · (k1 + 1)) / (tf(t,d) + k1 · (1 - b + b · |d|/avgdl))) with `k1=1.5, b=0.75`.
- Reference resolution: regex `/^\s*(?:Run|Read|read):\s*([^\s]+)/m` and inline `<read>(\S+)</read>`-style. Resolve `relative` against the SKILL.md directory; absolute paths used as-is. Cap per-skill ref count to 10. Cache per session.

**Step 3:** Run the test → PASS.

**Step 4:** Commit.

```
git add src/skill-search.ts tests/skill-search.test.ts
git commit -m "feat(skills): fuzzy search over SKILL.md and referenced files"
```

---

### Task 3.4: New `skill` tool

**Files:**
- Modify: `src/index.ts`
- Modify: `src/types.ts` — add `ROLE_SKILL_TOOL_NAME = "skill"`
- Create: `tests/skill-tool.test.ts`

**Step 1 (test first):** Direct unit-tests against the tool's `execute` function (extract handler logic into `src/skill-tool.ts` for testability):

1. `search` returns `{ hits: [{name, snippet, score}] }`.
2. `activate` adds to the active set and returns `{ activated: name }`.
3. `activate` on an out-of-scope skill returns `{ error: "skill not in scope" }`.
4. `deactivate` removes from the active set; no-op when not active.
5. `info` returns frontmatter + filePath + description.
6. Unknown action returns an error.

Run → FAIL.

**Step 2:** Create `src/skill-tool.ts` exporting `createSkillToolHandler(ctx)` where `ctx` is a small struct passed by `index.ts`: `{ getRole, getActive, setActive, allSkills, persist }`. The handler is parameterized so tests can inject fixtures.

**Step 3:** Define the Typebox schema in `src/skill-tool.ts`:

```typescript
const SKILL_TOOL_PARAMETERS = Type.Object({
	action: Type.Union([
		Type.Literal("search"),
		Type.Literal("activate"),
		Type.Literal("deactivate"),
		Type.Literal("info"),
	]),
	name: Type.Optional(Type.String()),
	query: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});
```

**Step 4:** In `src/index.ts`, register the tool inside `refreshCatalog`/`registerRoleSwitchTool`-style helper. Description includes the current role's skill scope summary so the model knows the in-scope universe.

**Step 5:** Run `tests/skill-tool.test.ts` → PASS. Run the full unit suite.

**Step 6:** Commit.

```
git add src/ tests/skill-tool.test.ts
git commit -m "feat(skills): new `skill` tool with search/activate/deactivate/info"
```

---

### Task 3.5: Apply required/inherit_loaded on role switch and session boot

**Files:**
- Modify: `src/index.ts`

**Step 1:** In `applyRoleState`, after determining `state.activeRole`:

```typescript
const previousActive = activeSkills;
const carried = role.skills.inheritLoaded ? previousActive : [];
const required = applyRequiredSkills(carried, role, lastKnownSkills);
activeSkills = required;
persistActiveSkills();
```

**Step 2:** In `session_start` (after `branchState`), if `activeSkills.length === 0`, also run `applyRequiredSkills` once for the active role.

**Step 3:** Add a harness test `tests/harness-role-switch-skills.ts` that asserts: switching from role A (active=[X]) to role B (`inheritLoaded:false`, required=[Y]) yields active=[Y].

**Step 4:** Run `npm run test:harness`. Commit.

```
git add src/ tests/harness-role-switch-skills.ts package.json
git commit -m "feat(skills): apply required + inherit_loaded on role switch"
```

(Remember to extend `test:harness` in `package.json`.)

---

### Task 3.6: Wire `readActiveSkillBodies` into the template handler

**Files:**
- Modify: `src/index.ts`

**Step 1:** Replace the stub from Task 2.4 with the real call: `readActiveSkillBodies(activeSkills)`.

**Step 2:** Smoke-test by running the harness with a role that has a required skill and verifying the system prompt contains the active block. Add this assertion to the harness.

**Step 3:** Commit.

```
git add src/ tests/
git commit -m "feat(skills): inject active skill bodies into system prompt"
```

---

## Phase 4 — Ask UX (per-session approvals + primary-arg picker)

### Task 4.1: Per-session approvals store

**Files:**
- Create: `src/ask-store.ts`
- Create: `tests/ask-store.test.ts`

**Step 1 (test first):**

1. `createAskStore()` returns an object with `isApproved(tool, input)`, `approveTool(tool)`, `approveToolArgs(tool, input)`, `reset()`.
2. `approveTool(bash)` then `isApproved("bash", anyInput)` → `true`.
3. `approveToolArgs("bash", { command: "ls" })` then `isApproved("bash", { command: "ls" })` → `true`, but `isApproved("bash", { command: "pwd" })` → `false`.
4. Hash function is stable across object key ordering: `{a:1,b:2}` === `{b:2,a:1}`.

Run → FAIL.

**Step 2:** Implement with a canonical JSON serializer (sort keys recursively) and SHA-256 (`node:crypto`). Two `Set<string>` instances: `approvedTools`, `approvedToolArgs`.

**Step 3:** Run → PASS.

**Step 4:** Commit.

```
git add src/ask-store.ts tests/ask-store.test.ts
git commit -m "feat(ask): per-session approvals store"
```

---

### Task 4.2: Settings reader/writer for `roles.ask.primaryToolArgs`

**Files:**
- Modify: `src/config.ts`
- Create: `tests/config-ask.test.ts`

**Step 1 (test first):**

1. `loadAskConfig(cwd)` merges global + project `roles.ask.primaryToolArgs` and bundled defaults (project wins).
2. Bundled defaults include keys for `bash`, `write`, `edit`, `read`, `grep`, `find`, `ls`, `web_fetch`, `shell_exec`, `shell_write_stdin`, `shell_kill_session`.
3. `saveAskPrimaryToolArg("bash", "command", { scope: "global", agentDir })` writes to `<agentDir>/settings.json` preserving other keys.
4. Same with `scope: "project"` writes to `<cwd>/.pi/settings.json`.
5. Invalid JSON in the target file → throws a typed error, does not corrupt the file.

Run → FAIL.

**Step 2:** Implement. Use atomic write: write to `path.tmp`, `fs.renameSync`. Keep 2-space indentation. Deep-merge only the `roles.ask.primaryToolArgs` subtree; preserve everything else.

**Step 3:** Run → PASS.

**Step 4:** Commit.

```
git add src/config.ts tests/config-ask.test.ts
git commit -m "feat(ask): read/write roles.ask.primaryToolArgs"
```

---

### Task 4.3: Detail formatter

**Files:**
- Create: `src/ask-detail.ts`
- Create: `tests/ask-detail.test.ts`

**Step 1 (test first):**

1. `formatDetail("bash", {command:"rm -rf tmp"}, askConfig)` → `"bash rm -rf tmp"`.
2. `formatDetail("write", {path:"foo.log", content:"…"}, askConfig)` → `"write foo.log"`.
3. Truncation to 240 chars with `…` suffix.
4. Unknown dot-path returns `""`.
5. `flattenInput({a: {b: 1}, c: "x"})` → `[["a.b", "1"], ["c", "\"x\""]]`.

Run → FAIL.

**Step 2:** Implement `formatDetail`, `flattenInput`, and a small dot-path getter `getByPath(obj, path)`.

**Step 3:** Run → PASS.

**Step 4:** Commit.

```
git add src/ask-detail.ts tests/ask-detail.test.ts
git commit -m "feat(ask): detail formatter with primary-arg dot-path support"
```

---

### Task 4.4: Primary-arg picker dialog

**Files:**
- Create: `src/ask-picker.ts`

**Step 1:** Pure function `buildPickerOptions(input): PickerOption[]` returns the rows we'd show — covered by an existing test via `flattenInput`. Wire the picker as an async function `pickPrimaryArg(ctx, toolName, input)`:

```typescript
export async function pickPrimaryArg(ctx, toolName, input): Promise<{ path?: string; scope: "global" | "project" | "session" | "skip" }> {
	const flat = flattenInput(input);
	if (flat.length === 0) return { scope: "skip" };
	if (flat.length === 1) {
		const scope = await pickScope(ctx, toolName, flat[0]![0]);
		return { path: flat[0]![0], scope };
	}
	const rows = [
		...flat.map(([path, preview]) => ({ label: `${path}  →  ${preview}`, value: path })),
		{ label: "<entire input>", value: "" },
		{ label: "<skip — no detail this turn>", value: "__skip__" },
	];
	const picked = await ctx.ui.select(`Pick the primary argument for "${toolName}"`, rows);
	if (picked === undefined || picked === "__skip__") return { scope: "skip" };
	const scope = await pickScope(ctx, toolName, picked);
	return { path: picked, scope };
}
```

Where `pickScope` is a second `ctx.ui.select` with `[Global (default), Project, Just for this session]`.

**Step 2:** No unit test for the dialog itself (it's pure UI orchestration); covered indirectly by integration in 4.5. Commit.

```
git add src/ask-picker.ts
git commit -m "feat(ask): primary-arg picker dialog"
```

---

### Task 4.5: New `tool_call` handler

**Files:**
- Modify: `src/index.ts`

**Step 1:** Replace the existing `tool_call` handler:

```typescript
pi.on("tool_call", async (event, ctx) => {
	const role = currentRole();
	if (!role) return;
	if (role.tools.hidden.some((p) => globMatch(event.toolName, p))) {
		return { block: true, reason: `Tool ${event.toolName} is hidden by role ${role.name}.` };
	}
	const action = matchToolPolicy(role, event.toolName);
	if (action === "deny") return { block: true, reason: `Tool ${event.toolName} is denied by role ${role.name}.` };
	if (action !== "ask") return;

	if (askStore.isApproved(event.toolName, event.input)) return;

	if (!ctx.hasUI) {
		return { block: true, reason: `Tool ${event.toolName} requires confirmation in role ${role.name}.` };
	}

	const askConfig = loadAskConfig(ctx.cwd);
	let primaryPath = askConfig.primaryToolArgs[event.toolName];
	if (primaryPath === undefined) {
		const picked = await pickPrimaryArg(ctx, event.toolName, event.input);
		if (picked.scope === "global" || picked.scope === "project") {
			saveAskPrimaryToolArg(event.toolName, picked.path ?? "", { scope: picked.scope, agentDir: process.env.PI_CODING_AGENT_DIR ?? getAgentDir(), cwd: ctx.cwd });
		}
		primaryPath = picked.path ?? "";
	}

	const detail = formatDetail(event.toolName, event.input, { primaryToolArgs: { [event.toolName]: primaryPath } });
	const choice = await ctx.ui.select(`Allow ${event.toolName}?`, [
		{ label: `Allow once (${detail})`, value: "once" },
		{ label: `Always allow ${event.toolName} this session`, value: "tool" },
		{ label: `Always allow ${event.toolName} with these args this session`, value: "args" },
		{ label: "Deny", value: "deny" },
	]);

	if (choice === "tool") askStore.approveTool(event.toolName);
	if (choice === "args") askStore.approveToolArgs(event.toolName, event.input);
	if (choice === "deny" || choice === undefined) {
		return { block: true, reason: `Tool ${event.toolName} was denied by the user.` };
	}
});
```

**Step 2:** Initialize `askStore` in `session_start`, reset on `session_shutdown`.

**Step 3:** Add a harness `tests/harness-ask-flow.ts` that uses the test pi runtime to drive a scripted ask interaction (the picker can be bypassed in tests by pre-seeding `primaryToolArgs`). Verify the four button outcomes.

**Step 4:** Run full suite, commit.

```
git add src/ tests/harness-ask-flow.ts package.json
git commit -m "feat(ask): primary-arg picker + per-session approvals + new dialog"
```

---

## Phase 5 — Tools symmetry hardening

### Task 5.1: Respect `tools.hidden` in `setActiveTools`

**Files:**
- Modify: `src/policy.ts` (`filterVisibleTools`)
- Modify: `tests/tool-policy.test.ts`

**Step 1:** Already partially done in Task 1.4; extend test to assert that hidden tools are not in `visibleTools` even when they match an `allow` glob downstream.

**Step 2:** Run, commit.

```
git add src/ tests/
git commit -m "test(policy): hidden tools removed from visibility"
```

---

## Phase 6 — Docs, migration, release

### Task 6.1: README + migration cheatsheet

**Files:**
- Modify: `README.md`
- Create: `docs/migration-v2.md`
- Create: `examples/migration-cheatsheet.md`

**Step 1:** README gets a 2.0 highlights section linking to `docs/migration-v2.md`. Migration doc covers each shape transformation with before/after YAML side by side, plus the `roles.ask.primaryToolArgs` settings example.

**Step 2:** Cheatsheet is a 1-page quick reference.

**Step 3:** Commit.

```
git add README.md docs/migration-v2.md examples/migration-cheatsheet.md
git commit -m "docs: v2 migration guide and README updates"
```

---

### Task 6.2: CHANGELOG breaking entry

**Files:**
- Modify: `CHANGELOG.md`

**Step 1:** Promote `2.0.0-dev.0` to `2.0.0` and fill in:

- `### Breaking` — schema hard-switch, `read SKILL.md` no longer the activation path (use `skill activate`).
- `### Added` — `skill` tool, system-prompt template, ask UX with picker, `roles.ask.primaryToolArgs`.
- `### Changed` — internal `ResolvedRole` shape.
- `### Migration` — link to `docs/migration-v2.md`.

**Step 2:** Bump `package.json` to `2.0.0`.

```
git add CHANGELOG.md package.json
git commit -m "chore(release): 2.0.0"
git tag v2.0.0
```

---

### Task 6.3: Final verification

**Step 1:** `npm test` — full pipeline (typecheck + unit + harness).
Expected: green.

**Step 2:** `npm pack --dry-run` — confirm `templates/`, `skills/`, `src/`, docs ship.

**Step 3:** Manual TUI walkthrough (beta-test):
- Start `pi` in the worktree with `-e ./src/index.ts`.
- `/role:manage` → switch roles.
- Force an `ask` tool, walk through picker + 4-button dialog.
- Use `skill` tool: `search`, `activate`, then `/compact` and verify the active block is still in the next system prompt.

**Step 4:** Push branch and tag, open PR.

```
git push origin v2-rescope
git push origin v2.0.0
```

---

## Risk register

| Risk | Mitigation |
|---|---|
| `buildSystemPrompt` signature change in a pi minor release | Pin tested pi version in `peerDependencies` examples; harness covers the call. |
| Active-skill block bloats context | Per-skill 8 KB cap + total 32 KB cap with truncation marker. |
| `ctx.ui.select` not available on all surfaces | Detect and fall back to `ctx.ui.confirm` two-button + skip the picker. |
| Existing users with v1 role files | Hard fail with diagnostic + migration doc link; ship optional `pi-agent-roles:migrate` later. |
| Session-resume after schema change | `reconstructActiveSkills` tolerates missing field; default to `[]`. |

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-05-20-roles-v2-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open new session in the `pi-agent-roles-v2` worktree with `/skill:executing-plans`, batch execution with checkpoints.

**Which approach?**
