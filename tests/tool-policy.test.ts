import assert from "node:assert/strict";
import {
	buildRoleSwitchDescription,
	executeRoleSwitch,
	filterVisibleTools,
	getAgentSwitchableRoles,
	matchSkillPolicy,
	matchToolPolicy,
} from "../src/policy.js";
import type { ResolvedRole, RoleRuntimeState } from "../src/types.js";

function makeRole(overrides: Partial<ResolvedRole>): ResolvedRole {
	return {
		name: "builder",
		label: "Builder",
		description: "General coding role.",
		index: 0,
		displayColor: "accent",
		activation: "both",
		sticky: false,
		triggerDescription: "Use for general implementation work.",
		triggerGuidelines: [],
		model: { raw: "inherit", inherit: true },
		thinking: undefined,
		temperature: undefined,
		tools: [{ pattern: "*", action: "allow" }],
		skills: [{ pattern: "*", action: "optional" }],
		hasExplicitSkills: false,
		promptMode: "append",
		body: "Instructions.",
		filePath: "/tmp/builder.md",
		scope: "project",
		agentSwitchable: true,
		...overrides,
	};
}

const builder = makeRole({
	tools: [
		{ pattern: "*", action: "ask" },
		{ pattern: "bash", action: "allow" },
		{ pattern: "web_*", action: "deny" },
	],
	skills: [
		{ pattern: "*", action: "hidden" },
		{ pattern: "systematic-debugging", action: "required" },
		{ pattern: "requesting-*", action: "optional" },
	],
	hasExplicitSkills: true,
});
const reviewer = makeRole({
	name: "reviewer",
	label: "Reviewer",
	index: 1,
	triggerDescription: "Use for review and critique tasks.",
	body: "Reviewer instructions.",
});
const userOnly = makeRole({
	name: "user-only",
	label: "User Only",
	index: 2,
	activation: "user",
	triggerDescription: "User-only role should never be agent-switchable.",
	agentSwitchable: false,
});

assert.equal(matchToolPolicy(builder, "bash"), "allow");
assert.equal(matchToolPolicy(builder, "read"), "ask");
assert.equal(matchToolPolicy(builder, "web_search"), "deny");
assert.equal(matchSkillPolicy(builder, "systematic-debugging"), "required");
assert.equal(matchSkillPolicy(builder, "requesting-code-review"), "optional");
assert.equal(matchSkillPolicy(builder, "other-skill"), "hidden");

const visible = filterVisibleTools(["read", "bash", "web_search", "role:switch"], builder, true);
assert.deepEqual(visible.visibleTools, ["read", "bash", "role:switch"]);
assert.deepEqual(visible.askTools, ["read", "role:switch"]);

assert.deepEqual(getAgentSwitchableRoles([builder, reviewer, userOnly], builder).map((role) => role.name), ["reviewer"]);

const description = buildRoleSwitchDescription({
	currentRole: builder,
	stickyLocked: false,
	switchableRoles: [reviewer],
});
assert.match(description, /Current role: `builder` \(Builder\)/);
assert.match(description, /reviewer/);
assert.match(description, /Do not use this when the current role is sticky-locked by the user\./);

let state: RoleRuntimeState = {
	activeRole: "builder",
	activationSource: "user",
	stickyLocked: false,
};
let result = executeRoleSwitch({ role: "reviewer", reason: "Need review mode" }, state, [builder, reviewer, userOnly]);
assert.equal(result.details.status, "success");
assert.equal(result.state.activeRole, "reviewer");
assert.equal(result.state.previousRole, "builder");
assert.equal(result.details.activeRole, "reviewer");
assert.equal(result.details.previousRole, "builder");

result = executeRoleSwitch({ role: "reviewer" }, result.state, [builder, reviewer, userOnly]);
assert.equal(result.details.status, "success");
assert.equal(result.details.summary, "Role `reviewer` is already active.");

state = { activeRole: "builder", activationSource: "user", stickyLocked: true };
result = executeRoleSwitch({ role: "reviewer" }, state, [builder, reviewer, userOnly]);
assert.equal(result.details.status, "error");
assert.match(result.details.summary, /sticky-locked/);
assert.equal(result.state.activeRole, "builder");

state = { activeRole: "builder", activationSource: "user", stickyLocked: false };
result = executeRoleSwitch({ role: "missing" }, state, [builder, reviewer, userOnly]);
assert.equal(result.details.status, "error");
assert.match(result.details.summary, /Unknown role `missing`/);

result = executeRoleSwitch({ role: "user-only" }, state, [builder, reviewer, userOnly]);
assert.equal(result.details.status, "error");
assert.match(result.details.summary, /not agent-switchable/);

console.log("tool policy tests passed");
