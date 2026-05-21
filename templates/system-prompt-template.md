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
