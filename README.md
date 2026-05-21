# pi-agent-roles

`pi-agent-roles` adds **session-scoped runtime roles** to the pi coding agent.
A role can change the active model, thinking level, temperature, tool policy,
role instructions, and visible skills without restarting pi. Because apparently
changing the entire agent personality mid-session is the sane way to work now.

Compatibility note: the LLM-callable role-switch tool is named `role_switch`.
Pi tool names only accept `[a-zA-Z0-9_-]`, so the original colon version had to
die. Tragic, really.

## 2.0 highlights

- Hard schema switch for role files: `skills` and `tools` now use nested v2 blocks.
- Roles can rescope skills with `skills.roots`, `inherit_loaded`, `required`, `optional`, and `hidden`.
- Tools now use `tools.inherit`, `allow`, `ask`, and `hidden`.
- Ask prompts can render a useful detail line and remember it via `roles.ask.primaryToolArgs`.
- Migration guide: [`docs/migration-v2.md`](docs/migration-v2.md)
- Quick reference: [`examples/migration-cheatsheet.md`](examples/migration-cheatsheet.md)

## Install

From npm:

```sh
pi install npm:@furbyhaxx/pi-agent-roles
```

From GitHub:

```sh
pi install git:https://github.com/furbyhaxx/pi-agent-roles
```

From a local checkout:

```sh
git clone https://github.com/furbyhaxx/pi-agent-roles
pi install path/to/pi-agent-roles
```

Load directly without installing:

```sh
pi -e path/to/pi-agent-roles/src/index.ts
```

## What it does

- Discovers role files from global and project role roots.
- Restores the active role per session branch.
- Applies role-specific model, thinking, temperature, tool visibility, and tool confirmation policy.
- Rescopes visible skills per role with `skills.roots`, `inherit_loaded`, `required`, `optional`, and `hidden`.
- Registers a `skill` tool for `search`, `activate`, `deactivate`, and `info`.
- Injects role metadata, in-scope skill catalogs, active skill bodies, and role state through a system-prompt template.
- Filters hidden skills from the prompt and blocks hidden `/skill:` use while the role is active.
- Exposes `/role:manage`, `/role:reload`, and `/role:unstick`.
- Registers a cycle shortcut, default `ctrl+r`.
- Exposes an LLM-callable `role_switch` tool only when switching is currently allowed.
- Adds ask-dialog detail rendering with configurable `roles.ask.primaryToolArgs` defaults/overrides.
- Skips `temperature` injection for configured provider/model globs such as `openai-codex/*`.
- Integrates with `pi-fancy-editor` through the shared event bus and falls back to a compact widget below the editor when fancy-editor is not present.
- Bundles the `role-creator` skill and exposes it dynamically through `resources_discover`.

## Commands and shortcut

- `/role:manage` — open the interactive role manager
- `/role:reload` — rescan role files and reapply runtime role state without reloading the whole pi runtime
- `/role:unstick` — clear the sticky lock on the current role
- `ctrl+r` by default — cycle user-activatable roles in `index`, then `name` order

## Example role pack

The repo ships a live-test role pack in `examples/roles/`, including roles such as:

- `brainstormer`
- `developer`
- `typescript-developer`
- `reviewer`
- `prompt-engineer`
- `tool-designer`
- `extension-architect`
- `skill-architect`
- `debugger`
- `planner`
- `beta-tester`
- `researcher`
- `ui-designer`
- `ux-designer`
- `release-manager`

For local testing, the repo-local `.pi/roles/` directory can symlink these files so
pi discovers them immediately in this checkout.

## Role manager UI

Approved MVP behavior:

- **Wide terminals:** responsive two-pane manager
- **Narrow terminals:** compact single-pane manager
- Supports list, resolved detail view, select, create, and edit

Wide layout:

```text
Roles                                   │ Reviewer
                                         │
> Builder ●                             │ Role: Reviewer (reviewer)
  General coding role.                  │ Description: Review code and plans.
  Reviewer                              │ Activation: both
  Review code and plans.                │ Sticky default: no
                                         │ Model: inherit
enter select • v view • c create • e edit │ Tools: *:deny, read:allow, grep:allow
```

Compact layout:

```text
Roles
Reviewer (reviewer)
Review code and plans.

> Builder ●
  Reviewer
  Researcher

enter select • v details • c create • e edit • esc close
```

Fallback widget when `pi-fancy-editor` is not active/ready:

```text
[Role: Builder]
```

## Fancy editor integration

The extension emits the active role on pi's shared event bus:

```text
pi-agent-roles:active-role
```

Payload shape:

```ts
{
  name: string;
  label: string;
  color?: string; // pi theme token or #rrggbb
}
```

`null` clears the role display.

## Discovery and configuration

Roles are discovered from:

- `${PI_CODING_AGENT_DIR:-~/.pi/agent}/roles`
- `./.pi/roles`
- optional extra roots from `settings.json`

Configuration lives in pi's regular settings files:

- global: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/settings.json`
- project: `.pi/settings.json`

Default config:

```json
{
  "roles": {
    "default": null,
    "roots": [],
    "cycleShortcut": "ctrl+r",
    "userSwitchMode": "end_turn",
    "showWidgetWhenFancyEditorMissing": true,
    "temperatureBlacklist": ["openai-codex/*"]
  }
}
```

Example with overrides:

```json
{
  "roles": {
    "default": "builder",
    "roots": [
      "~/work/pi-roles",
      "./tools/agent-roles"
    ],
    "cycleShortcut": "ctrl+r",
    "userSwitchMode": "instant",
    "showWidgetWhenFancyEditorMissing": true,
    "temperatureBlacklist": [
      "openai-codex/*",
      "google/*"
    ]
  }
}
```

Ask detail rendering config lives in the same settings files under `roles.ask`:

```json
{
  "roles": {
    "ask": {
      "primaryToolArgs": {
        "bash": "command",
        "write": "path",
        "custom_tool": "request.payload.target",
        "noisy_tool": false
      }
    }
  }
}
```

### Settings behavior

- project settings override global settings
- `roles.ask.primaryToolArgs` values are dot-paths into the tool input; `false` disables the detail line for that tool
- `roots` supports `~`, `$VAR`, and `${VAR}` expansion
- `userSwitchMode`:
  - `end_turn` — queue user switches until the agent becomes idle
  - `instant` — apply immediately
- `temperatureBlacklist` blocks provider/model globs from receiving role-level `temperature`
- default blacklist: `openai-codex/*`
- if no valid role files are found, the built-in fallback `builder` role is used

## Role file format

Roles are markdown files with YAML frontmatter. Discovery is recursive for `*.md`
under each configured root.

v2 is a hard schema switch. Legacy flat arrays/maps for `skills` and `tools` are
rejected. See [`docs/migration-v2.md`](docs/migration-v2.md).

Example:

```markdown
---
name: builder
label: Builder
description: General-purpose builder role.
index: 0
color: accent
activation: both
sticky: false
triggerDescription: Use for general coding and implementation work when no more specialized role is a better fit.
triggerGuidelines:
  - Full tool access.
model: anthropic/claude-sonnet-4-5:high
thinking: high
temperature: 0.2

tools:
  inherit: true
  allow:
    - "*"
  ask:
    - web_*
  hidden:
    - role_switch_internal_*

skills:
  roots:
    inherit: true
    dirs:
      - ./.pi/skillsets/shared
  inherit_loaded: true
  required:
    - systematic-debugging
  optional:
    - requesting-code-review
  hidden:
    - role-creator

prompt: append
---
Role-specific instructions go here.
```

### Color values

`color` accepts:

- pi theme tokens: `accent`, `success`, `warning`, `error`, `muted`, `dim`, `text`
- built-in aliases: `orange`, `red`, `green`, `teal`, `blue`, `purple`, `pink`, `yellow`, `cyan`
- hex colors like `#ff8800`
- omitted: pi-agent-roles generates and caches a stable fallback color by role name

## Agent tool surface

The package exposes two LLM-callable tools:

- `role_switch` — switch to another agent-switchable role when switching is currently allowed
- `skill` — `search`, `activate`, `deactivate`, or `info` for skills in scope for the active role

`role_switch` is exposed only when all of these are true:

- the current role is not sticky-locked
- the current role is not user-only
- at least one alternative agent-switchable role exists

`role_switch` returns the active role plus applied runtime changes.

`skill` follows the active role's skill visibility rules and uses the system-prompt
template to keep the in-scope catalog and active skill content visible to the model.

## Bundled skill

The package bundles `skills/role-creator/SKILL.md`, but intentionally does **not**
list it in the package manifest. The extension exposes it dynamically through
`resources_discover`.

## Development

Install deps and run checks:

```sh
npm install
npm test
```

Harness coverage is included in `npm test`:

- `tests/harness-role-switch.ts` — exercises real session role switching,
  prompt shaping, tool visibility, and provider payload temperature override
- `tests/harness-package-install.ts` — packs the package, installs it into a
  sandbox project, and smoke-tests the installed extension

If your local pi-test-harness checkout is not at
`/Projects/furbyhaxx/pi-coding-agent/pi-test-harness`, set one of these before
running the harness scripts:

```sh
export PI_TEST_HARNESS_PATH=/path/to/pi-test-harness
# or
export PI_TEST_HARNESS_DIR=/path/to/pi-test-harness
```

Live smoke test:

```sh
pi -e ./src/index.ts
```

Then exercise:

- `/role:manage`
- `/role:unstick`
- cycle roles with `ctrl+r`
- prompt the agent in a role where `role_switch` is visible

## License

MIT
