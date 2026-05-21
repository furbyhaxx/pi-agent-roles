export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type RoleScope = "global" | "project" | "builtin";
export type RoleActivation = "user" | "agent" | "both";
export type ToolPolicyAction = "allow" | "ask" | "deny";
export type SkillPolicyAction = "required" | "optional" | "hidden";
export type RolePromptMode = "append" | "replace";
export type UserSwitchMode = "instant" | "end_turn";
export type ActivationSource = "startup" | "restore" | "user" | "agent";

/** @deprecated Transitional flat rule shape kept for compiled last-match-wins policy views. */
export interface ToolPolicyRule {
	pattern: string;
	action: ToolPolicyAction;
}

/** @deprecated Transitional flat rule shape kept for compiled last-match-wins policy views. */
export interface SkillPolicyRule {
	pattern: string;
	action: SkillPolicyAction;
}

export interface SkillsRootsConfig {
	inherit: boolean;
	dirs: string[];
}

export interface RoleSkillsConfig {
	roots: SkillsRootsConfig;
	inheritLoaded: boolean;
	required: string[];
	optional: string[];
	hidden: string[];
	rules: SkillPolicyRule[];
}

export interface RoleToolsConfig {
	inherit: boolean;
	allow: string[];
	ask: string[];
	hidden: string[];
	rules: ToolPolicyRule[];
}

export interface ModelSelection {
	raw: string;
	provider?: string;
	modelId?: string;
	inlineThinking?: ThinkingLevel;
	inherit: boolean;
}

export interface RolesConfig {
	defaultRole?: string;
	roots: string[];
	cycleShortcut: string;
	userSwitchMode: UserSwitchMode;
	showWidgetWhenFancyEditorMissing: boolean;
	temperatureBlacklist: string[];
}

export interface LoadedRolesConfig {
	config: RolesConfig;
	defaultRoots: string[];
	globalRoots: string[];
	projectRoots: string[];
	allRoots: string[];
	sources: string[];
}

export interface RoleDiagnostic {
	level: "warning" | "error";
	message: string;
	path?: string;
}

export interface ResolvedRole {
	name: string;
	label: string;
	description: string;
	index: number;
	displayColor: string;
	activation: RoleActivation;
	sticky: boolean;
	triggerDescription?: string;
	triggerGuidelines: string[];
	model: ModelSelection;
	thinking?: ThinkingLevel;
	temperature?: number;
	tools: RoleToolsConfig;
	skills: RoleSkillsConfig;
	hasExplicitSkills: boolean;
	promptMode: RolePromptMode;
	body: string;
	filePath: string;
	scope: RoleScope;
	agentSwitchable: boolean;
}

export interface DiscoverRolesResult {
	roles: ResolvedRole[];
	diagnostics: RoleDiagnostic[];
}

export interface PendingUserRoleSwitch {
	targetRole: string;
	sticky: boolean;
}

export interface RoleRuntimeState {
	activeRole: string;
	activationSource: ActivationSource;
	stickyLocked: boolean;
	pendingUserRoleSwitch?: PendingUserRoleSwitch;
	previousRole?: string;
	queuedReminder?: string;
	lastSwitchReason?: string;
}

export interface RoleSwitchToolDetails {
	status: "success" | "error";
	summary: string;
	activeRole: string;
	previousRole?: string;
	activationSource: ActivationSource;
	stickyLocked: boolean;
	applied?: {
		model?: string;
		thinking?: ThinkingLevel;
		temperature?: number;
		visibleTools?: string[];
		askTools?: string[];
		requiredSkills?: string[];
		optionalSkills?: string[];
	};
}

export interface RoleSwitchActionResult {
	state: RoleRuntimeState;
	details: RoleSwitchToolDetails;
}

export interface RoleDisplayPayload {
	name: string;
	label: string;
	color?: string;
}

export const ROLE_STATE_ENTRY_TYPE = "pi-agent-roles-state";
export const ROLE_SWITCH_TOOL_NAME = "role_switch";
export const ROLE_MANAGER_COMMAND = "role:manage";
export const ROLE_RELOAD_COMMAND = "role:reload";
export const ROLE_UNSTICK_COMMAND = "role:unstick";
export const PI_AGENT_ROLES_ACTIVE_ROLE_EVENT = "pi-agent-roles:active-role";
