import assert from "node:assert/strict";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { buildRoleStateContext, filterHiddenSkillsFromPrompt, filterSkillsForRole, formatRolesSystemPrompt } from "../src/prompt.js";
import type { ResolvedRole, RoleSkillsConfig, RoleToolsConfig } from "../src/types.js";

function mkTools(overrides: Partial<RoleToolsConfig> = {}): RoleToolsConfig {
	return {
		inherit: true,
		allow: [],
		ask: [],
		hidden: [],
		rules: [{ pattern: "*", action: "allow" }],
		...overrides,
	};
}

function mkSkills(overrides: Partial<RoleSkillsConfig> = {}): RoleSkillsConfig {
	return {
		roots: { inherit: true, dirs: [] },
		inheritLoaded: true,
		required: [],
		optional: [],
		hidden: [],
		rules: [{ pattern: "*", action: "optional" }],
		...overrides,
	};
}

const builderRole = {
	name: "builder",
	label: "Builder",
	description: "General coding role.",
	index: 0,
	displayColor: "accent",
	activation: "both",
	sticky: false,
	triggerDescription: "Use for general coding and implementation work.",
	triggerGuidelines: ["Full tool access."],
	model: { raw: "anthropic/claude-sonnet-4-5:high", provider: "anthropic", modelId: "claude-sonnet-4-5", inlineThinking: "high", inherit: false },
	thinking: "high",
	temperature: 0.2,
	tools: mkTools(),
	skills: mkSkills(),
	hasExplicitSkills: false,
	promptMode: "append",
	body: "Builder instructions.",
	filePath: "/tmp/builder.md",
	scope: "project",
	agentSwitchable: true,
} satisfies ResolvedRole;

const reviewerRole = {
	...builderRole,
	name: "reviewer",
	label: "Reviewer",
	index: 1,
	description: "Review role.",
	triggerDescription: "Use for audit, review, and critique tasks.",
	body: "Reviewer instructions.",
	skills: mkSkills({
		required: ["requesting-code-review"],
		hidden: ["*"],
		rules: [
			{ pattern: "*", action: "optional" },
			{ pattern: "*", action: "hidden" },
			{ pattern: "requesting-code-review", action: "required" },
		],
	}),
	hasExplicitSkills: true,
} satisfies ResolvedRole;

const systemPrompt = formatRolesSystemPrompt({
	currentRole: builderRole,
	switchableRoles: [reviewerRole],
	stickyLocked: false,
});
assert.match(systemPrompt, /## Roles/);
assert.match(systemPrompt, /Current role: `builder` \(Builder\)/);
assert.match(systemPrompt, /general coding and implementation work/i);
assert.match(systemPrompt, /reviewer/);
assert.doesNotMatch(systemPrompt, /user-only/i);

const unavailable = formatRolesSystemPrompt({
	currentRole: builderRole,
	switchableRoles: [],
	stickyLocked: true,
});
assert.match(unavailable, /sticky-locked/i);
assert.match(unavailable, /No alternative agent-switchable roles are available right now\./);

const context = buildRoleStateContext({
	currentRole: reviewerRole,
	activationSource: "agent",
	stickyLocked: false,
	switchingAllowed: true,
	requiredSkills: ["requesting-code-review"],
	optionalSkills: [],
	reminder: "<system-reminder>Role reminder.</system-reminder>",
});
assert.match(context, /<role-state>/);
assert.match(context, /<current-role id="reviewer" label="Reviewer" source="agent" sticky="false" \/>/);
assert.match(context, /Use `role_switch` only when another listed role is a better fit\./);
assert.match(context, /Reviewer instructions\./);
assert.match(context, /<required>requesting-code-review<\/required>/);
assert.match(context, /Role reminder\./);

const loadedSkills = [
	{
		name: "systematic-debugging",
		description: "Use when debugging unexpected behavior.",
		filePath: "/tmp/systematic-debugging/SKILL.md",
		baseDir: "/tmp/systematic-debugging",
		sourceInfo: { path: "/tmp/systematic-debugging/SKILL.md", source: "path", scope: "temporary", origin: "top-level" as const },
		disableModelInvocation: false,
	},
	{
		name: "requesting-code-review",
		description: "Use before merge or completion.",
		filePath: "/tmp/requesting-code-review/SKILL.md",
		baseDir: "/tmp/requesting-code-review",
		sourceInfo: { path: "/tmp/requesting-code-review/SKILL.md", source: "path", scope: "temporary", origin: "top-level" as const },
		disableModelInvocation: false,
	},
] satisfies Skill[];

const promptWithSkills = `<available_skills>
  <skill>
    <name>systematic-debugging</name>
    <description>Use when debugging unexpected behavior.</description>
    <location>/tmp/systematic-debugging/SKILL.md</location>
  </skill>
  <skill>
    <name>requesting-code-review</name>
    <description>Use before merge or completion.</description>
    <location>/tmp/requesting-code-review/SKILL.md</location>
  </skill>
</available_skills>`;

const filtered = filterHiddenSkillsFromPrompt(promptWithSkills, loadedSkills, reviewerRole);
assert.doesNotMatch(filtered, /systematic-debugging/);
assert.match(filtered, /requesting-code-review/);

const visibleSkills = filterSkillsForRole(loadedSkills, reviewerRole);
assert.deepEqual(visibleSkills.map((skill) => skill.name), ["requesting-code-review"]);

const scopedSkills = filterSkillsForRole(
	loadedSkills,
	{
		...builderRole,
		skills: mkSkills({
			roots: { inherit: false, dirs: ["/tmp/requesting-code-review"] },
		}),
	},
);
assert.deepEqual(scopedSkills.map((skill) => skill.name), ["requesting-code-review"]);

console.log("prompt tests passed");
