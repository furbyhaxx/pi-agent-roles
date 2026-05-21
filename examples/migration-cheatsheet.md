# v2 migration cheatsheet

Full guide: [`../docs/migration-v2.md`](../docs/migration-v2.md)

## Legacy → v2

- `skills: [a, b]` → `skills.required: [a, b]`
- `skills: { a: required, b: optional, c: hidden }` → split into `required`, `optional`, `hidden` arrays
- `tools: [read, grep]` → `tools.inherit: false` + `tools.allow: [read, grep]`
- `tools: { read: allow, bash: ask, web_*: deny }` → split into `allow`, `ask`, `hidden` arrays

## Minimal v2 skeleton

```yaml
skills:
  roots:
    inherit: true
    dirs: []
  inherit_loaded: true
  required: []
  optional: []
  hidden: []

tools:
  inherit: true
  allow: []
  ask: []
  hidden: []
```

## Rules that matter

- `tools.inherit: true` keeps the normal tool catalog.
- `tools.inherit: false` starts from deny-by-default.
- `tools.hidden` is the v2 replacement for legacy `deny`.
- `skills.inherit_loaded: false` clears currently active skills on role switch.
- Relative `skills.roots.dirs` paths resolve from the role file directory.

## Ask prompt detail config

```json
{
  "roles": {
    "ask": {
      "primaryToolArgs": {
        "bash": "command",
        "read": "path",
        "write": "path",
        "custom_tool": "request.payload.target"
      }
    }
  }
}
```

## Sanity check

- Rewrite every legacy `skills`/`tools` block.
- Add `inherit: false` only for explicit allow-lists.
- Legacy shapes are rejected; they are not auto-migrated.
