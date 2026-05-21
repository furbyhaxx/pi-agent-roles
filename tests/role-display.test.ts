import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
	PI_FANCY_EDITOR_ROLE_DISPLAY_READY_EVENT,
	PI_AGENT_ROLES_ACTIVE_ROLE_EVENT,
	clearActiveRoleDisplay,
	emitActiveRoleDisplay,
	resolveRoleManagerLayout,
	shouldShowFallbackWidget,
} from "../src/display.js";
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
	displayColor: "#ff8800",
	activation: "both",
	sticky: false,
	triggerDescription: "Use for implementation work.",
	triggerGuidelines: [],
	model: { raw: "inherit", inherit: true },
	thinking: undefined,
	temperature: undefined,
	tools: mkTools(),
	skills: mkSkills(),
	hasExplicitSkills: false,
	promptMode: "append",
	body: "Instructions.",
	filePath: "/tmp/builder.md",
	scope: "project",
	agentSwitchable: true,
} satisfies ResolvedRole;

const events = new EventEmitter();
const emitted: unknown[] = [];
events.on(PI_AGENT_ROLES_ACTIVE_ROLE_EVENT, (payload) => emitted.push(payload));
events.on(PI_FANCY_EDITOR_ROLE_DISPLAY_READY_EVENT, (payload) => emitted.push({ ready: payload }));

emitActiveRoleDisplay(events as never, builderRole);
assert.deepEqual(emitted.at(-1), { name: "builder", label: "Builder", color: "#ff8800" });

clearActiveRoleDisplay(events as never);
assert.equal(emitted.at(-1), null);

assert.equal(resolveRoleManagerLayout(140), "wide");
assert.equal(resolveRoleManagerLayout(80), "compact");
assert.equal(shouldShowFallbackWidget({ fancyEditorReady: false, showWidgetWhenFancyEditorMissing: true }), true);
assert.equal(shouldShowFallbackWidget({ fancyEditorReady: true, showWidgetWhenFancyEditorMissing: true }), false);
assert.equal(shouldShowFallbackWidget({ fancyEditorReady: false, showWidgetWhenFancyEditorMissing: false }), false);

console.log("role display tests passed");
