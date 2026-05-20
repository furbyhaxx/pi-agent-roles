---
name: role-creator
description: Create or refine pi-agent-roles role files with valid frontmatter, tool policy, skill policy, model/thinking settings, and role-specific instructions. Use when the user wants a new runtime role, wants to edit an existing role markdown file, or needs help designing role switching behavior for pi-agent-roles.
---

# Role Creator

Create or update `pi-agent-roles` role markdown files.

## What this skill is for

Use this skill when the user wants to:

- create a new role file under a pi roles root
- modify an existing role definition
- design tool/skill policy for a role
- choose activation rules (`user`, `agent`, `both`) or sticky behavior
- tune per-role model, thinking, or temperature settings

## Workflow

1. Clarify the role's purpose.
2. Choose the activation policy:
   - `user` for user-only roles
   - `agent` for agent-only roles
   - `both` when either side may activate it
3. Decide whether manual user activation should be sticky.
4. Define tool policy:
   - `allow` = visible and callable
   - `ask` = visible but each call needs confirmation
   - `deny` = hidden and blocked
5. Define skill policy:
   - `required` = highlight and instruct the agent to use when relevant
   - `optional` = visible and allowed
   - `hidden` = removed from role-filtered prompt and blocked via `/skill:` while active
6. Decide whether the role body should `append` to the default role instructions or `replace` them.
7. Write the full markdown file.

## Output rules

Always produce the complete role file, not a partial snippet.

Use this exact structure unless the user asks for a different valid variant:

```markdown
---
name: builder
label: Builder
description: Human-facing description for the manager UI.
index: 0
color: accent
activation: both
sticky: false
triggerDescription: Use for general coding and implementation work when no specialized role is a better fit.
triggerGuidelines:
  - Full tool access.
model: inherit
thinking: high
temperature: inherit
tools:
  "*": allow
skills:
  "*": optional
prompt: append
---
Role-specific instructions go here.
```

## Validation checklist

Before finalizing a role file, verify:

- `name` is lowercase letters, numbers, and hyphens only
- no leading/trailing hyphen and no consecutive hyphens
- `triggerDescription` exists when `activation` is `agent` or `both`
- `sticky: true` is not used on an agent-only role
- tool and skill rules use only supported actions
- the role body gives useful behavioral guidance, not just a label restatement

## Notes

- If the user gives a tool allowlist like `read, grep, find`, prefer the shorthand role format only when it stays readable.
- If the user wants a locked manual mode, use `sticky: true` and explain that `/role:unstick` clears it.
- If the user is unsure about `prompt: append` vs `replace`, default to `append`.
- If the user does not provide a color, omit it and let pi-agent-roles generate a stable cached fallback color.
