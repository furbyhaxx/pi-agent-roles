# pi-agent-roles

`pi-agent-roles` adds **session-scoped runtime roles** to the pi coding agent.
A role can change the active model, thinking level, temperature, tool policy,
role instructions, and visible skills without restarting pi. Because apparently
changing the entire agent personality mid-session is the sane way to work now.

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
- Filters hidden skills from the prompt and blocks hidden `/skill:` use while the role is active.
- Injects stable role metadata in `before_agent_start` and live role state in `context`.
- Exposes `/role:manage` and `/role:unstick`.
- Registers a cycle shortcut, default `ctrl+r`.
- Exposes an LLM-callable `role:switch` tool only when switching is currently allowed.
- Integrates with `pi-fancy-editor` through the shared event bus and falls back to a compact widget below the editor when fancy-editor is not present.
- Bundles the `role-creator` skill and exposes it dynamically through `resources_discover`.

## Commands and shortcut

- `/role:manage` — open the interactive role manager
- `/role:unstick` — clear the sticky lock on the current role
- `ctrl+r` by default — cycle user-activatable roles in `index`, then `name` order

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

Fallback widget when `pi-fancy-editor` is not listening:

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
    "showWidgetWhenFancyEditorMissing": true
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
    "showWidgetWhenFancyEditorMissing": true
  }
}
```

### Settings behavior

- project settings override global settings
- `roots` supports `~`, `$VAR`, and `${VAR}` expansion
- `userSwitchMode`:
  - `end_turn` — queue user switches until the agent becomes idle
  - `instant` — apply immediately
- if no valid role files are found, the built-in fallback `builder` role is used

## Role file format

Roles are markdown files with YAML frontmatter. Discovery is recursive for `*.md`
under each configured root.

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
  "*": allow
  "web_*": ask
skills:
  "*": optional
  systematic-debugging: required
  requesting-code-review: optional
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

`role:switch` is the only LLM-callable tool in the package.

It is exposed only when all of these are true:

- the current role is not sticky-locked
- the current role is not user-only
- at least one alternative agent-switchable role exists

The tool returns the active role plus applied runtime changes.

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

Live smoke test:

```sh
pi -e ./src/index.ts
```

Then exercise:

- `/role:manage`
- `/role:unstick`
- cycle roles with `ctrl+r`
- prompt the agent in a role where `role:switch` is visible

## License

MIT
