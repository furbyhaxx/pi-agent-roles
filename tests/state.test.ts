import assert from "node:assert/strict";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	ROLE_STATE_ENTRY_TYPE,
	applyPendingUserRoleSwitch,
	clearStickyLock,
	createRoleState,
	reconstructRoleState,
	requestUserRoleSwitch,
} from "../src/state.js";

let state = createRoleState("builder", "startup", false);
assert.equal(state.activeRole, "builder");
assert.equal(state.activationSource, "startup");
assert.equal(state.stickyLocked, false);

let queued = requestUserRoleSwitch(state, {
	targetRole: "reviewer",
	sticky: false,
	userSwitchMode: "end_turn",
	agentIsIdle: false,
});
assert.equal(queued.applied, false);
assert.equal(queued.state.activeRole, "builder");
assert.equal(queued.state.pendingUserRoleSwitch?.targetRole, "reviewer");

let applied = applyPendingUserRoleSwitch(queued.state);
assert.equal(applied.applied, true);
assert.equal(applied.state.activeRole, "reviewer");
assert.equal(applied.state.activationSource, "user");
assert.equal(applied.state.pendingUserRoleSwitch, undefined);
assert.equal(applied.state.previousRole, "builder");

queued = requestUserRoleSwitch(applied.state, {
	targetRole: "builder",
	sticky: true,
	userSwitchMode: "instant",
	agentIsIdle: false,
});
assert.equal(queued.applied, true);
assert.equal(queued.state.activeRole, "builder");
assert.equal(queued.state.stickyLocked, true);
assert.match(queued.state.queuedReminder ?? "", /sticky role `builder`/);

const unlocked = clearStickyLock(queued.state);
assert.equal(unlocked.stickyLocked, false);
assert.match(unlocked.queuedReminder ?? "", /removed the sticky lock/);

const entries = [
	{
		type: "custom",
		customType: ROLE_STATE_ENTRY_TYPE,
		data: {
			activeRole: "builder",
			activationSource: "startup",
			stickyLocked: false,
		},
	},
	{
		type: "custom",
		customType: ROLE_STATE_ENTRY_TYPE,
		data: {
			activeRole: "reviewer",
			activationSource: "agent",
			stickyLocked: false,
			previousRole: "builder",
		},
	},
	{
		type: "custom",
		customType: ROLE_STATE_ENTRY_TYPE,
		data: {
			activeRole: "builder",
			activationSource: "user",
			stickyLocked: true,
			pendingUserRoleSwitch: { targetRole: "reviewer", sticky: false },
		},
	},
] as SessionEntry[];

const restored = reconstructRoleState(entries);
assert.equal(restored?.activeRole, "builder");
assert.equal(restored?.activationSource, "user");
assert.equal(restored?.stickyLocked, true);
assert.equal(restored?.pendingUserRoleSwitch?.targetRole, "reviewer");
assert.equal(reconstructRoleState([]), undefined);

console.log("state tests passed");
