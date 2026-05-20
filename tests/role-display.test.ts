import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
	PI_AGENT_ROLES_ACTIVE_ROLE_EVENT,
	clearActiveRoleDisplay,
	emitActiveRoleDisplay,
	resolveRoleManagerLayout,
	shouldShowFallbackWidget,
} from "../src/display.js";
import type { ResolvedRole } from "../src/types.js";

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
	tools: [{ pattern: "*", action: "allow" }],
	skills: [{ pattern: "*", action: "optional" }],
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

emitActiveRoleDisplay(events as never, builderRole);
assert.deepEqual(emitted.at(-1), { name: "builder", label: "Builder", color: "#ff8800" });

clearActiveRoleDisplay(events as never);
assert.equal(emitted.at(-1), null);

assert.equal(resolveRoleManagerLayout(140), "wide");
assert.equal(resolveRoleManagerLayout(80), "compact");
assert.equal(shouldShowFallbackWidget({ fancyEditorListenerCount: 0, showWidgetWhenFancyEditorMissing: true }), true);
assert.equal(shouldShowFallbackWidget({ fancyEditorListenerCount: 1, showWidgetWhenFancyEditorMissing: true }), false);
assert.equal(shouldShowFallbackWidget({ fancyEditorListenerCount: 0, showWidgetWhenFancyEditorMissing: false }), false);

console.log("role display tests passed");
