import { ROLE_SWITCH_TOOL_NAME, type ResolvedRole, type RoleRuntimeState, type RoleSwitchActionResult, type SkillPolicyAction, type ToolPolicyAction } from "./types.js";

function patternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

function lastMatchingAction<T extends { pattern: string; action: ToolPolicyAction | SkillPolicyAction }>(rules: readonly T[], name: string) {
	let action = rules[0]?.action;
	for (const rule of rules) {
		if (patternToRegExp(rule.pattern).test(name)) action = rule.action;
	}
	return action;
}

export function matchToolPolicy(role: ResolvedRole, toolName: string): ToolPolicyAction {
	return (lastMatchingAction(role.tools, toolName) as ToolPolicyAction | undefined) ?? "allow";
}

export function matchSkillPolicy(role: ResolvedRole, skillName: string): SkillPolicyAction {
	return (lastMatchingAction(role.skills, skillName) as SkillPolicyAction | undefined) ?? "optional";
}

export function filterVisibleTools(
	allToolNames: readonly string[],
	role: ResolvedRole,
	roleSwitchVisible: boolean,
): { visibleTools: string[]; askTools: string[] } {
	const visibleTools: string[] = [];
	const askTools: string[] = [];
	for (const name of allToolNames) {
		if (name === ROLE_SWITCH_TOOL_NAME && !roleSwitchVisible) continue;
		const action = matchToolPolicy(role, name);
		if (action === "deny") continue;
		visibleTools.push(name);
		if (action === "ask") askTools.push(name);
	}
	return { visibleTools, askTools };
}

function canAgentSwitchFromRole(role: ResolvedRole, stickyLocked: boolean): boolean {
	return !stickyLocked && role.activation !== "user";
}

export function getAgentSwitchableRoles(roles: readonly ResolvedRole[], currentRole: ResolvedRole): ResolvedRole[] {
	return roles
		.filter((role) => role.name !== currentRole.name && role.agentSwitchable)
		.sort((left, right) => left.index - right.index || left.name.localeCompare(right.name));
}

export function buildRoleSwitchDescription(options: {
	currentRole: ResolvedRole;
	stickyLocked: boolean;
	switchableRoles: readonly ResolvedRole[];
}): string {
	const roleList = options.switchableRoles.length > 0
		? options.switchableRoles.map((role) => `\`${role.name}\` (${role.label})`).join(", ")
		: "none";
	const permission = canAgentSwitchFromRole(options.currentRole, options.stickyLocked) && options.switchableRoles.length > 0
		? "allowed"
		: "not allowed";
	return [
		"Switch the active pi role for the current session.",
		"Use this when the task phase, risk profile, or required capabilities fit another available role better.",
		"Do not use this when the current role is sticky-locked by the user.",
		`Current role: \`${options.currentRole.name}\` (${options.currentRole.label}).`,
		`Switching is currently ${permission}.`,
		`Switchable roles right now: ${roleList}.`,
		"Returns the active role and the applied runtime changes.",
	].join(" ");
}

function summarizeRole(role: ResolvedRole) {
	const requiredSkills = role.skills.filter((rule) => rule.action === "required").map((rule) => rule.pattern);
	const optionalSkills = role.skills.filter((rule) => rule.action === "optional" && rule.pattern !== "*").map((rule) => rule.pattern);
	return {
		model: role.model.inherit ? undefined : role.model.raw,
		thinking: role.thinking,
		temperature: role.temperature,
		requiredSkills,
		optionalSkills,
	};
}

export function executeRoleSwitch(
	input: { role: string; reason?: string },
	state: RoleRuntimeState,
	roles: readonly ResolvedRole[],
): RoleSwitchActionResult {
	const currentRole = roles.find((role) => role.name === state.activeRole) ?? roles[0];
	const switchableRoles = currentRole ? getAgentSwitchableRoles(roles, currentRole) : [];
	if (!currentRole) {
		return {
			state,
			details: {
				status: "error",
				summary: "No roles are available.",
				activeRole: state.activeRole,
				activationSource: state.activationSource,
				stickyLocked: state.stickyLocked,
			},
		};
	}
	if (state.stickyLocked) {
		return {
			state,
			details: {
				status: "error",
				summary: `Role switching is unavailable because the current role \`${currentRole.name}\` is sticky-locked by the user.`,
				activeRole: state.activeRole,
				activationSource: state.activationSource,
				stickyLocked: state.stickyLocked,
			},
		};
	}
	if (!canAgentSwitchFromRole(currentRole, state.stickyLocked)) {
		return {
			state,
			details: {
				status: "error",
				summary: `Role switching is not allowed from the current role \`${currentRole.name}\`.`,
				activeRole: state.activeRole,
				activationSource: state.activationSource,
				stickyLocked: state.stickyLocked,
			},
		};
	}
	const targetRole = roles.find((role) => role.name === input.role);
	if (!targetRole) {
		return {
			state,
			details: {
				status: "error",
				summary: `Unknown role \`${input.role}\`.`,
				activeRole: state.activeRole,
				activationSource: state.activationSource,
				stickyLocked: state.stickyLocked,
			},
		};
	}
	if (targetRole.name === state.activeRole) {
		return {
			state,
			details: {
				status: "success",
				summary: `Role \`${targetRole.name}\` is already active.`,
				activeRole: state.activeRole,
				previousRole: state.previousRole,
				activationSource: state.activationSource,
				stickyLocked: state.stickyLocked,
				applied: summarizeRole(targetRole),
			},
		};
	}
	if (!switchableRoles.some((role) => role.name === targetRole.name)) {
		return {
			state,
			details: {
				status: "error",
				summary: `Role \`${targetRole.name}\` is not agent-switchable right now.`,
				activeRole: state.activeRole,
				activationSource: state.activationSource,
				stickyLocked: state.stickyLocked,
			},
		};
	}
	const nextState: RoleRuntimeState = {
		activeRole: targetRole.name,
		activationSource: "agent",
		stickyLocked: false,
		pendingUserRoleSwitch: undefined,
		previousRole: state.activeRole,
		lastSwitchReason: input.reason,
	};
	return {
		state: nextState,
		details: {
			status: "success",
			summary: `Activated role \`${targetRole.name}\`.`,
			activeRole: targetRole.name,
			previousRole: state.activeRole,
			activationSource: "agent",
			stickyLocked: false,
			applied: summarizeRole(targetRole),
		},
	};
}
