# pi-agent-roles v2 — skill rescoping, tool symmetry, ask-prompt details

Status: design draft, awaiting user sign-off before planning/implementation.

Tracks the items in `TODOS.md` plus the user's clarifications collected during brainstorming on 2026-05-20.

## Goals
1. `ask` tool-policy prompt becomes informative and learnable (per-session "always allow").
2. Roles can fully rescope which skills the agent sees, with explicit `roots`, `inherit_loaded`, `required`, `optional`, and `hidden` keys.
3. Tools config mirrors the new skills shape.
4. Replace pi's auto-generated skill catalog in the system prompt with our own template-driven block, so role state and the new `skill` tool are first-class.
5. Hard switch on the role-file schema. Bundled/example roles get migrated.

Out of scope for this iteration: changing how role files are discovered, adding new model/thinking knobs, the role widget look.

## 1. Ask-prompt details

### Detail rendering
- Per-tool formatters for the common builtins (`bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `web_fetch`, `shell_exec`, `shell_write_stdin`, `shell_kill_session`). These ship with sensible default `primaryToolArgs` values so the user is never asked about them.
- For any other tool with no entry in `primaryToolArgs`, before showing the allow/deny dialog we show a short interactive **"pick the primary argument"** dialog (see below).
- Once a primary arg is known (defaulted, configured, or just picked), it is rendered as `<tool> <value>` truncated to ~240 chars on a single line; a multi-line view is available when `ctx.ui.confirm` supports a body.
- Settings persistence at `roles.ask.primaryToolArgs` (in `~/.pi/agent/settings.json` and `.pi/settings.json`):
  ```json
  {
    "roles": {
      "ask": {
        "primaryToolArgs": {
          "bash": "command",
          "write": "path",
          "edit": "path",
          "shell_exec": "command",
          "web_fetch": "url",
          "custom_tool": "request.payload.target"
        }
      }
    }
  }
  ```
  Values are dot-paths into `event.input`. Empty string or `false` disables detail rendering for that tool. The map merges global ← project, with project winning on conflicts.

### Primary-arg picker (first-time UX)
When `ask` triggers for a tool that has **no** entry in either settings file AND no bundled default:
1. Flatten `event.input` to a list of `(dotPath, valuePreview)` entries. Each value is JSON-stringified and truncated to ~80 chars per row.
2. Show `ctx.ui.select` with rows like `command  →  "rm -rf tmp/test.log"` plus two extra rows: `<entire input>` and `<skip — no detail this turn>`.
3. After the user picks a row, show a second `ctx.ui.select`: **Save where?**
   - `Global (~/.pi/agent/settings.json)` *(default)*
   - `Project (.pi/settings.json)`
   - `Just for this session (don't save)`
4. Persist the chosen dot-path into `roles.ask.primaryToolArgs.<toolName>` at the chosen scope using pi's `SettingsManager` write APIs. Skipping or "just this session" only updates the in-memory map.
5. Continue to the regular allow/deny dialog using the picked detail.

Edge cases:
- If `event.input` is empty or has only one field, skip the picker and use that field automatically.
- Non-interactive context: fall back to the generic first-key rendering and do not write any settings.

### Confirm UI
Replace the current `ctx.ui.confirm(...)` two-button dialog with `ctx.ui.select` offering:
1. **Allow once** (default focus).
2. **Always allow `<tool>` this session** — remember by tool name, regardless of args.
3. **Always allow `<tool>` with these args this session** — remember by `(tool, normalized-input-hash)` pair.
4. **Deny**.

State lives in memory keyed by session id. It resets on `session_shutdown`, `session_start { reason: "new" | "fork" | "resume" }`, and on role switch (the new role's `ask` policy is independent — the user's per-session approvals carry over only for tools that still have `ask` policy).

If `ctx.ui` is unavailable (non-interactive), behave like `deny` as today.

## 2. Role file schema (hard switch)

```yaml
---
name: developer
label: Developer
description: General-purpose implementation role.
index: 10
color: cyan
activation: both
sticky: false
triggerDescription: Use for implementation work.
triggerGuidelines:
  - Prefer test-driven development.
model: inherit
thinking: medium
temperature: 0.2

skills:
  roots:
    inherit: false           # if false, ignore globally-discovered skill paths
    dirs:                    # absolute, ~-expansion, or repo-relative paths
      - ".pi/skillsets/dev"
      - "~/.pi/agent/skills/dev-extras"
  inherit_loaded: false      # if false, deactivate every skill currently active in the session on switch in
  required:                  # auto-activated; supports glob
    - test-driven-development
    - systematic-debugging
  optional:                  # surfaced to the user in the role manager + role-state context
    - using-git-worktrees
  hidden:                    # explicit deny-list; supports glob
    - role-creator

tools:
  inherit: false             # if false, ignore the global tool catalog discovered through extensions/builtins
  ask:
    - bash
    - write
  allow:
    - "*"
  hidden:
    - role_switch_internal_*
---

# Role body (markdown)
Free-form instructions appended/replaced by `prompt: append|replace`.
```

### Hard-switch migration

- Every example role in `examples/roles/` and any bundled role-creator templates are rewritten to the new schema.
- `parseRoleFile` rejects the old shapes (`tools: ["a", "b"]`, `skills: ["a", "b"]`, `tools: { a: allow }`, `skills: { a: required }`) with a clear diagnostic that points to the migration section in the README.
- `CHANGELOG.md` gets a `### Breaking` entry calling out the schema change and the migration note.
- A one-shot `pi-agent-roles:migrate` command can transform old role files in place. Optional, can ship later.

### Internal types
- `ToolPolicyRule` and `SkillPolicyRule` keep the `(pattern, action)` shape for fast lookup, but `ResolvedRole` now also carries:
  - `skills: { roots: { inherit: boolean; dirs: string[] }; inheritLoaded: boolean; required: string[]; optional: string[]; hidden: string[]; rules: SkillPolicyRule[] }`
  - `tools: { inherit: boolean; rules: ToolPolicyRule[] }`
- `rules` is the compiled view used by `matchSkillPolicy` / `matchToolPolicy` (last-match wins, identical to today). We compile in this order: `[*: hidden if !inherit] + [hidden] + [optional] + [required]` for skills; `[*: deny if !inherit] + [hidden: deny] + [ask] + [allow]` for tools.

## 3. Skills as a first-class subsystem

### New `skill` tool (replaces `read`-on-SKILL.md as the activation path)
```
skill(action: "search" | "activate" | "deactivate" | "info", ...)
```
- `search { query: string, limit?: number }`: fuzzy search across all in-scope `SKILL.md` content **and the files they reference** (relative paths in code blocks, `read /path` style mentions). Returns `[{name, snippet, score}]`. Implementation: cache file contents on `resources_discover`, run a simple BM25 / fuse.js style scorer; references resolved as `skillDir + relativePath` and parsed lazily.
- `activate { name: string }`: load the skill's full `SKILL.md` content into the **role-managed skill context block** so it survives compaction. Returns short ack only (not the body — body lives in injected context).
- `deactivate { name: string }`: drop the skill from the active set.
- `info { name: string }`: returns frontmatter, file path, and short description without activating.

No `list` action: the in-scope catalog is rendered into the system prompt by our template every turn (via `{{availableSkills}}` and `{{activeSkills}}`), so the model already has the list and an authoritative active/inactive marker without spending a tool call.

### Compaction-resistant active skills
- An "active skill set" is stored via `pi.appendEntry("pi-agent-roles-active-skills", { active: [{name, filePath, contentHash}] })` so it persists across reloads/forks and is reconstructed from the session log.
- On every `before_agent_start`, we read the SKILL.md content for each active skill from disk and inject it into a dedicated `<active-skills>` section of the system prompt. This is cheap and always fresh. Because it's recomputed every turn, compaction can summarize history but the active block is re-emitted afterwards.
- `inherit_loaded: false` clears the active set on role switch. `inherit_loaded: true` keeps it.
- Required skills are auto-activated on role switch and on session start (matched against the role's in-scope catalog).

### System prompt takeover
- We register a higher-priority `before_agent_start` handler that calls `buildSystemPrompt(modifiedOptions)` with `skills: []`, then appends our own template-rendered block.
- The template lives at `~/.pi/agent/roles/system-prompt-template.md` (project: `.pi/roles/system-prompt-template.md`), with a bundled default at `<package>/templates/system-prompt-template.md`. The first existing path wins.
- Template engine: minimal `{{handlebars-style}}` with safe placeholders, no JS execution. Available variables:
  - `{{builtinSystemPrompt}}` — the prompt produced by `buildSystemPrompt` minus pi's auto skill catalog.
  - `{{role.name}}`, `{{role.label}}`, `{{role.description}}`, `{{role.body}}`, `{{role.triggerDescription}}`.
  - `{{role.requiredSkills}}` / `{{role.optionalSkills}}` / `{{role.hiddenSkills}}` — array helpers via `{{#each ...}}{{name}} — {{description}}{{/each}}`.
  - `{{availableSkills}}` — in-scope catalog under the active role's roots and policy.
  - `{{activeSkills}}` — currently activated skills with full body (compaction-resistant block).
  - `{{switchableRoles}}` and `{{switching.allowed}}`.
  - `{{state}}` for the current role-state XML block.
- Default template preserves today's behavior (role section + role-state block) while replacing pi's auto skill catalog with `{{availableSkills}}` rendered as a compact catalog and `{{activeSkills}}` rendered as full content.

### Cross-checks
- `/skill:<name>` slash commands are still allowed for in-scope skills; out-of-scope hits notify and stop, as today. `activate`/`deactivate` go through the same code path.
- The fallback `read` of `<skillDir>/SKILL.md` still works; we don't intercept reads. The model just shouldn't need to do that anymore because the catalog points at the `skill` tool.

## 4. Tools symmetry

- `tools.inherit: false` removes everything the role doesn't explicitly list (sets the implicit `*: deny` baseline). With `true`, the baseline is `*: allow` as today.
- `tools.hidden: [...]` denies and removes from `pi.setActiveTools(...)`, so the model never sees the tool description either. Mirrors `skills.hidden`.
- Per-session "always allow" approvals interact with `ask` and never elevate a `deny` or `hidden` tool.

## 5. Compatibility & migration plan

- Single `2.0.0` release. CHANGELOG gets a Breaking section with concrete examples for the four most common patterns.
- Rewrite all bundled example roles. Add `examples/migration-cheatsheet.md`.
- Smoke-tested cases:
  - Role with `skills.roots.inherit: false` + 0 dirs → catalog is empty, only `required` appear (loaded explicitly from absolute paths if listed; warning otherwise).
  - Role with `tools.inherit: false` + only `bash` allowed → only `bash` and `role_switch` are visible.
  - Switch from role A (active skills X, Y) to role B (`inherit_loaded: false`) → X, Y get deactivated and removed from the active block; role B's required skills get activated.
  - Ask flow: user picks "always for this tool" → next call of same tool runs without prompt; `agent_end` does not clear it; `session_shutdown` does.

## 6. Open questions (track for the planning phase)
- Should the `roles.ask.primaryToolArgs` map be merged with role-level overrides? Current decision: settings.json only.
- Search ranking lib: keep zero-deps with a tiny BM25 implementation, or pull `fuse.js` (small, MIT)?
- Active-skill block size: should we cap total bytes injected to avoid context blow-up? Proposal: per-skill cap 8 KB, total cap 32 KB, with truncation note.

## 7. Test plan (high level)
- Unit: schema parser (positive + negative for old shapes), policy compilation, dot-path detail extractor, fuzzy search ranker.
- Integration with pi runtime mocks: role switch lifecycle (skills activate/deactivate, ask state cleared), system prompt template rendering, compaction round-trip preserves active block.
- Manual TUI walkthrough: ask dialog with all four buttons, role manager showing required/optional/hidden, `/skill` interactions under scoped roots.
