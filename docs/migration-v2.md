# v2 migration guide

`pi-agent-roles` 2.0 rejects the legacy flat `skills` and `tools` shapes.
Migrate every role file to the nested v2 schema before loading it.

This applies to roles under `~/.pi/agent/roles`, `.pi/roles`, and any extra
`roles.roots` directories.

## Shape transformations

### 1) `skills: [...]` → `skills.required`

<table>
<tr>
<th>Before (v1)</th>
<th>After (v2)</th>
</tr>
<tr>
<td valign="top">
<pre><code>skills:
  - systematic-debugging
  - writing-plans
</code></pre>
</td>
<td valign="top">
<pre><code>skills:
  required:
    - systematic-debugging
    - writing-plans
</code></pre>
</td>
</tr>
</table>

### 2) `skills: { name: action }` → split into `required`, `optional`, `hidden`

<table>
<tr>
<th>Before (v1)</th>
<th>After (v2)</th>
</tr>
<tr>
<td valign="top">
<pre><code>skills:
  systematic-debugging: required
  writing-plans: optional
  role-creator: hidden
</code></pre>
</td>
<td valign="top">
<pre><code>skills:
  required:
    - systematic-debugging
  optional:
    - writing-plans
  hidden:
    - role-creator
</code></pre>
</td>
</tr>
</table>

### 3) `tools: [...]` → explicit allow-list

<table>
<tr>
<th>Before (v1)</th>
<th>After (v2)</th>
</tr>
<tr>
<td valign="top">
<pre><code>tools:
  - read
  - grep
  - find
</code></pre>
</td>
<td valign="top">
<pre><code>tools:
  inherit: false
  allow:
    - read
    - grep
    - find
</code></pre>
</td>
</tr>
</table>

Arrays become `inherit: false` because the legacy array form was an explicit
allow-list, not “keep everything and also these”.

### 4) `tools: { name: action }` → split into `allow`, `ask`, `hidden`

<table>
<tr>
<th>Before (v1)</th>
<th>After (v2)</th>
</tr>
<tr>
<td valign="top">
<pre><code>tools:
  read: allow
  grep: allow
  bash: ask
  web_*: deny
</code></pre>
</td>
<td valign="top">
<pre><code>tools:
  inherit: true
  allow:
    - read
    - grep
  ask:
    - bash
  hidden:
    - web_*
</code></pre>
</td>
</tr>
</table>

`hidden` is the v2 replacement for legacy `deny`; it both denies the tool and
removes it from the visible tool list.

## v2-only keys worth adding

```yaml
skills:
  roots:
    inherit: false
    dirs:
      - ./skills/private
      - ~/.pi/agent/skills/shared
  inherit_loaded: false
  required:
    - systematic-debugging
  optional:
    - writing-plans
  hidden:
    - role-creator

tools:
  inherit: false
  allow:
    - read
    - grep
  ask:
    - bash
  hidden:
    - web_*
```

- `skills.roots.inherit`: keep or ignore globally discovered skill roots
- `skills.roots.dirs`: add extra skill roots; relative paths resolve from the role file directory
- `skills.inherit_loaded`: keep already-active skills on role switch (`true`) or clear them (`false`)
- `tools.inherit`: keep the normal tool catalog (`true`) or start from deny-by-default (`false`)

## `roles.ask.primaryToolArgs`

Use settings JSON to tell ask prompts which field to render as the short detail
line:

```json
{
  "roles": {
    "ask": {
      "primaryToolArgs": {
        "bash": "command",
        "read": "path",
        "write": "path",
        "custom_tool": "request.payload.target",
        "noisy_tool": false
      }
    }
  }
}
```

- Values are dot-paths into the tool input payload.
- `false` disables the detail line for that tool.
- Project settings override global settings.
- Common builtins already ship with defaults like `bash → command` and `read → path`.

## Quick check

- Rewrite every legacy `skills`/`tools` block.
- Add `inherit: false` only when you want an explicit allow-list baseline.
- Add `skills.roots` or `inherit_loaded: false` only if you need rescoping behavior.
- Keep [`examples/migration-cheatsheet.md`](../examples/migration-cheatsheet.md) open if you want the short version.
