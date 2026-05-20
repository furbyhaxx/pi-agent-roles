import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { ROLE_STATE_ENTRY_TYPE, type PendingUserRoleSwitch, type RoleRuntimeState, type UserSwitchMode } from "./types.js";

export { ROLE_STATE_ENTRY_TYPE } from "./types.js";

function asPending(value: unknown): PendingUserRoleSwitch | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as { targetRole?: unknown; sticky?: unknown };
	return typeof input.targetRole === "string"
		? { targetRole: input.targetRole, sticky: input.sticky === true }
		: undefined;
}

function stickyReminder(roleName: string): string {
	return `<system-reminder>The user explicitly selected sticky role \`${roleName}\`. Do not switch away from it unless the user changes roles or calls /role:unstick.</system-reminder>`;
}

function unstickReminder(roleName: string): string {
	return `<system-reminder>The user removed the sticky lock from the current role \`${roleName}\`. You may switch roles again with \`role:switch\` if another available role is a better fit.</system-reminder>`;
}

export function createRoleState(activeRole: string, activationSource: RoleRuntimeState["activationSource"], stickyLocked: boolean): RoleRuntimeState {
	return { activeRole, activationSource, stickyLocked };
}

export function reconstructRoleState(entries: readonly SessionEntry[]): RoleRuntimeState | undefined {
	let state: RoleRuntimeState | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== ROLE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as Record<string, unknown> | undefined;
		if (!data || typeof data.activeRole !== "string") continue;
		state = {
			activeRole: data.activeRole,
			activationSource: data.activationSource === "startup" || data.activationSource === "restore" || data.activationSource === "user" || data.activationSource === "agent"
				? data.activationSource
				: "restore",
			stickyLocked: data.stickyLocked === true,
			pendingUserRoleSwitch: asPending(data.pendingUserRoleSwitch),
			previousRole: typeof data.previousRole === "string" ? data.previousRole : undefined,
			queuedReminder: typeof data.queuedReminder === "string" ? data.queuedReminder : undefined,
			lastSwitchReason: typeof data.lastSwitchReason === "string" ? data.lastSwitchReason : undefined,
		};
	}
	return state;
}

function applyUserRole(state: RoleRuntimeState, targetRole: string, sticky: boolean): RoleRuntimeState {
	return {
		activeRole: targetRole,
		activationSource: "user",
		stickyLocked: sticky,
		pendingUserRoleSwitch: undefined,
		previousRole: state.activeRole,
		queuedReminder: sticky ? stickyReminder(targetRole) : undefined,
		lastSwitchReason: undefined,
	};
}

export function requestUserRoleSwitch(
	state: RoleRuntimeState,
	options: { targetRole: string; sticky: boolean; userSwitchMode: UserSwitchMode; agentIsIdle: boolean },
): { state: RoleRuntimeState; applied: boolean } {
	if (options.agentIsIdle || options.userSwitchMode === "instant") {
		return { state: applyUserRole(state, options.targetRole, options.sticky), applied: true };
	}
	return {
		state: {
			...state,
			pendingUserRoleSwitch: { targetRole: options.targetRole, sticky: options.sticky },
		},
		applied: false,
	};
}

export function applyPendingUserRoleSwitch(state: RoleRuntimeState): { state: RoleRuntimeState; applied: boolean } {
	const pending = state.pendingUserRoleSwitch;
	if (!pending) return { state, applied: false };
	return { state: applyUserRole(state, pending.targetRole, pending.sticky), applied: true };
}

export function clearStickyLock(state: RoleRuntimeState): RoleRuntimeState {
	if (!state.stickyLocked) return state;
	return {
		...state,
		stickyLocked: false,
		queuedReminder: unstickReminder(state.activeRole),
	};
}
