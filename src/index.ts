import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type { BuildSystemPromptOptions, ExtensionAPI, ExtensionContext, SessionEntry, Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverRoles } from "./discovery.js";
import {
	PI_FANCY_EDITOR_ROLE_DISPLAY_READY_EVENT,
	clearActiveRoleDisplay,
	emitActiveRoleDisplay,
	shouldShowFallbackWidget,
} from "./display.js";
import { loadRolesConfig } from "./config.js";
import {
	applyRoleTemperatureToPayload,
	buildRoleSwitchDescription,
	executeRoleSwitch,
	filterVisibleTools,
	getAgentSwitchableRoles,
	matchSkillPolicy,
	matchToolPolicy,
} from "./policy.js";
import { buildRoleStateContext, filterSkillsForRole } from "./prompt.js";
import { buildSkillToolDescription, createSkillToolHandler, SKILL_TOOL_PARAMETERS } from "./skill-tool.js";
import { ROLE_STATE_ENTRY_TYPE, applyPendingUserRoleSwitch, clearStickyLock, createRoleState, reconstructRoleState, requestUserRoleSwitch } from "./state.js";
import { loadSystemPromptTemplate } from "./template-loader.js";
import { renderTemplate } from "./template.js";
import { createRoleFlow, editRoleFlow, showRoleDetails, showRoleManager } from "./ui.js";
import { paintColor } from "./theme.js";
import {
	applyRequiredSkills,
	readActiveSkillBodies,
	reconstructActiveSkills,
	type ActiveSkill,
} from "./skill-runtime.js";
import {
	PI_AGENT_ROLES_ACTIVE_ROLE_EVENT,
	PI_AGENT_ROLES_ACTIVE_SKILLS_ENTRY_TYPE,
	ROLE_MANAGER_COMMAND,
	ROLE_RELOAD_COMMAND,
	ROLE_SKILL_TOOL_NAME,
	ROLE_SWITCH_TOOL_NAME,
	ROLE_UNSTICK_COMMAND,
	type DiscoverRolesResult,
	type LoadedRolesConfig,
	type ResolvedRole,
	type RoleRuntimeState,
} from "./types.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "..");
const bundledRoleCreatorPath = join(packageRoot, "skills", "role-creator");
const DEFAULT_ROLE_INSTRUCTIONS = [
	"Respect the active role for model, thinking, tool access, and skill visibility.",
	"Treat required skills as mandatory when they are relevant to the task.",
	"Do not bypass denied tools or hidden skills.",
].join("\n");
type BuildSystemPromptFn = (options: BuildSystemPromptOptions) => string;
type PiCodingAgentModule = typeof PiCodingAgent & { buildSystemPrompt?: BuildSystemPromptFn };

let buildSystemPromptPromise: Promise<BuildSystemPromptFn> | undefined;

const ROLE_SWITCH_PARAMETERS = Type.Object({
	role: Type.String({ description: "Target role id." }),
	reason: Type.Optional(Type.String({ description: "Optional short rationale for observability only." })),
});

function resolveBuildSystemPrompt(): Promise<BuildSystemPromptFn> {
	if (!buildSystemPromptPromise) {
		const rootExport = (PiCodingAgent as PiCodingAgentModule).buildSystemPrompt;
		buildSystemPromptPromise = rootExport
			? Promise.resolve(rootExport)
			: (async () => {
				const entryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
				const internalUrl = pathToFileURL(resolve(dirname(fileURLToPath(entryUrl)), "core", "system-prompt.js")).href;
				const internalModule = await import(internalUrl) as { buildSystemPrompt?: BuildSystemPromptFn };
				if (typeof internalModule.buildSystemPrompt !== "function") {
					throw new Error("@earendil-works/pi-coding-agent buildSystemPrompt export is unavailable.");
				}
				return internalModule.buildSystemPrompt;
			})();
	}
	return buildSystemPromptPromise;
}

function subscribeEventBus(
	eventBus: {
		on: (event: string, handler: (payload: unknown) => void) => unknown;
		off?: (event: string, handler: (payload: unknown) => void) => void;
		removeListener?: (event: string, handler: (payload: unknown) => void) => void;
	},
	event: string,
	handler: (payload: unknown) => void,
): () => void {
	const subscription = eventBus.on(event, handler);
	if (typeof subscription === "function") return subscription as () => void;
	return () => {
		eventBus.off?.(event, handler);
		eventBus.removeListener?.(event, handler);
	};
}

function appendText(base: string | undefined, addition: string): string {
	return base && base.trim() !== "" ? `${base}\n\n${addition}` : addition;
}

function appendTextToContent(content: unknown, addition: string): unknown {
	if (typeof content === "string") return appendText(content, addition);
	if (Array.isArray(content)) {
		let injected = false;
		const next = content.map((item) => {
			if (!injected && item && typeof item === "object" && "type" in item && (item as { type?: unknown }).type === "text") {
				injected = true;
				const current = item as { text?: unknown } & Record<string, unknown>;
				return {
					...current,
					text: appendText(typeof current.text === "string" ? current.text : "", addition),
				};
			}
			return item;
		});
		if (injected) return next;
		return [...next, { type: "text", text: addition }];
	}
	if (content && typeof content === "object" && "text" in (content as Record<string, unknown>)) {
		const current = content as { text?: unknown } & Record<string, unknown>;
		return {
			...current,
			text: appendText(typeof current.text === "string" ? current.text : "", addition),
		};
	}
	return content;
}

function injectRoleStateIntoPayload(payload: unknown, roleState: string): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	const next = { ...(payload as Record<string, unknown>) };
	if (typeof next.instructions === "string") {
		next.instructions = appendText(next.instructions, roleState);
		return next;
	}
	if (typeof next.system === "string") {
		next.system = appendText(next.system, roleState);
		return next;
	}
	if (Array.isArray(next.system)) {
		next.system = appendTextToContent(next.system, roleState);
		return next;
	}
	if (Array.isArray(next.messages)) {
		const messages = [...next.messages] as Array<Record<string, unknown>>;
		const firstSystemIndex = messages.findIndex((message) => message?.role === "system");
		if (firstSystemIndex >= 0) {
			const message = messages[firstSystemIndex]!;
			messages[firstSystemIndex] = {
				...message,
				content: appendTextToContent(message.content, roleState),
			};
		} else {
			messages.unshift({ role: "system", content: roleState });
		}
		next.messages = messages;
		return next;
	}
	next.instructions = roleState;
	return next;
}

function currentInstructions(role: ResolvedRole): string {
	return role.promptMode === "replace" && role.body.trim() !== ""
		? role.body.trim()
		: [DEFAULT_ROLE_INSTRUCTIONS, role.body.trim()].filter(Boolean).join("\n\n");
}

function stripPersistedState(state: RoleRuntimeState): Record<string, unknown> {
	return {
		activeRole: state.activeRole,
		activationSource: state.activationSource,
		stickyLocked: state.stickyLocked,
		pendingUserRoleSwitch: state.pendingUserRoleSwitch,
		previousRole: state.previousRole,
		lastSwitchReason: state.lastSwitchReason,
	};
}

function skillLists(role: ResolvedRole, skills: readonly Skill[]): { required: string[]; optional: string[] } {
	return {
		required: role.skills.required,
		optional: role.skills.optional,
	};
}

function roleSwitchAdvertised(role: ResolvedRole, state: RoleRuntimeState | undefined, roles: readonly ResolvedRole[]): boolean {
	if (!state) return false;
	if (state.stickyLocked) return false;
	if (role.activation === "user") return false;
	return getAgentSwitchableRoles(roles, role).length > 0;
}

export default function piAgentRolesExtension(pi: ExtensionAPI): void {
	let loadedConfig: LoadedRolesConfig | undefined;
	let discovered: DiscoverRolesResult = { roles: [], diagnostics: [] };
	let state: RoleRuntimeState | undefined;
	let lastPersistedKey = "";
	let lastPersistedActiveSkillsKey = "";
	let lastKnownSkills: Skill[] = [];
	let shortcutRegistered = false;
	let fancyEditorReady = false;
	let activeUiContext: ExtensionContext | undefined;
	let liveRoleStateContext = "";
	let activeSkillState: ActiveSkill[] = [];
	const shownDiagnostics = new Set<string>();
	const unsubscribeFancyEditorReady = subscribeEventBus(pi.events, PI_FANCY_EDITOR_ROLE_DISPLAY_READY_EVENT, (payload) => {
		fancyEditorReady = payload === true;
		if (activeUiContext?.hasUI) updateDisplay(activeUiContext);
	});

	function refreshCatalog(cwd: string): void {
		loadedConfig = loadRolesConfig(cwd);
		discovered = discoverRoles({
			agentDir: process.env.PI_CODING_AGENT_DIR,
			globalRoots: loadedConfig.globalRoots,
			projectRoots: loadedConfig.projectRoots,
		});
		registerSkillTool();
		registerRoleSwitchTool();
	}

	function currentRole(): ResolvedRole | undefined {
		if (discovered.roles.length === 0) return undefined;
		if (!state) return discovered.roles[0];
		return discovered.roles.find((role) => role.name === state?.activeRole) ?? discovered.roles[0];
	}

	function currentRoleStateContext(): string {
		const role = currentRole();
		if (!role || !state) return "";
		const skills = skillLists(role, lastKnownSkills);
		const reminder = state.queuedReminder;
		if (reminder) state = { ...state, queuedReminder: undefined };
		return buildRoleStateContext({
			currentRole: { ...role, body: currentInstructions(role) },
			activationSource: state.activationSource,
			stickyLocked: state.stickyLocked,
			switchingAllowed: roleSwitchAdvertised(role, state, discovered.roles),
			requiredSkills: skills.required,
			optionalSkills: skills.optional,
			reminder,
		});
	}

	function branchState(ctx: ExtensionContext, reason: "startup" | "restore"): RoleRuntimeState {
		const restored = reconstructRoleState(ctx.sessionManager.getBranch());
		if (restored && discovered.roles.some((role) => role.name === restored.activeRole)) {
			return {
				...restored,
				activationSource: reason,
			};
		}
		const configuredDefault = loadedConfig?.config.defaultRole;
		if (configuredDefault && discovered.roles.some((role) => role.name === configuredDefault)) {
			return createRoleState(configuredDefault, "startup", false);
		}
		return createRoleState(discovered.roles[0]?.name ?? "builder", "startup", false);
	}

	function persistState(): void {
		if (!state) return;
		const persisted = stripPersistedState(state);
		const key = JSON.stringify(persisted);
		if (key === lastPersistedKey) return;
		lastPersistedKey = key;
		pi.appendEntry(ROLE_STATE_ENTRY_TYPE, persisted);
	}

	function restoreActiveSkillState(branch: readonly SessionEntry[]): void {
		activeSkillState = reconstructActiveSkills(branch) ?? [];
		lastPersistedActiveSkillsKey = JSON.stringify({ active: activeSkillState });
	}

	function persistActiveSkills(): void {
		const persisted = { active: activeSkillState };
		const key = JSON.stringify(persisted);
		if (key === lastPersistedActiveSkillsKey) return;
		lastPersistedActiveSkillsKey = key;
		pi.appendEntry(PI_AGENT_ROLES_ACTIVE_SKILLS_ENTRY_TYPE, persisted);
	}

	function surfaceDiagnostics(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		for (const diagnostic of discovered.diagnostics) {
			const key = `${diagnostic.path ?? "<none>"}:${diagnostic.message}`;
			if (shownDiagnostics.has(key)) continue;
			shownDiagnostics.add(key);
			ctx.ui.notify(`[pi-agent-roles] ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ""}`, diagnostic.level === "error" ? "error" : "warning");
		}
	}

	function updateVisibleTools(): { visibleTools: string[]; askTools: string[] } {
		const role = currentRole();
		if (!role) return { visibleTools: [], askTools: [] };
		const allToolNames = pi.getAllTools().map((tool) => tool.name);
		const visibility = filterVisibleTools(allToolNames, role, roleSwitchAdvertised(role, state, discovered.roles));
		pi.setActiveTools(visibility.visibleTools);
		return visibility;
	}

	function updateDisplay(ctx: ExtensionContext): void {
		const role = currentRole();
		if (!role || !ctx.hasUI) return;
		emitActiveRoleDisplay(pi.events as never, role);
		if (shouldShowFallbackWidget({
			fancyEditorReady,
			showWidgetWhenFancyEditorMissing: loadedConfig?.config.showWidgetWhenFancyEditorMissing ?? true,
		})) {
			ctx.ui.setWidget(
				"pi-agent-roles",
				[paintColor(ctx.ui.theme as never, role.displayColor, `[Role: ${role.label}]`)],
				{ placement: "belowEditor" },
			);
		} else {
			ctx.ui.setWidget("pi-agent-roles", undefined);
		}
	}

	async function applyRoleState(
		ctx: ExtensionContext,
		nextState: RoleRuntimeState,
		options: { persist: boolean },
	): Promise<{ warnings: string[]; applied: { model?: string; thinking?: ResolvedRole["thinking"]; temperature?: number; visibleTools: string[]; askTools: string[]; requiredSkills: string[]; optionalSkills: string[] } }> {
		state = { ...nextState };
		const role = currentRole();
		if (!role) {
			return { warnings: ["No roles are available."], applied: { visibleTools: [], askTools: [], requiredSkills: [], optionalSkills: [] } };
		}
		if (state.activeRole !== role.name) state = { ...state, activeRole: role.name };
		const previousActive = activeSkillState;
		const carried = role.skills.inheritLoaded ? previousActive : [];
		const required = applyRequiredSkills(carried, role, lastKnownSkills);
		activeSkillState = required;
		persistActiveSkills();
		const warnings: string[] = [];
		let appliedModel: string | undefined;
		if (!role.model.inherit && role.model.provider && role.model.modelId) {
			const model = ctx.modelRegistry.find(role.model.provider, role.model.modelId);
			if (!model) warnings.push(`Unknown model ${role.model.raw}; keeping the current model.`);
			else {
				const success = await pi.setModel(model);
				if (success) appliedModel = `${model.provider}/${model.id}`;
				else warnings.push(`No API key is available for ${role.model.raw}; keeping the current model.`);
			}
		}
		if (role.thinking) pi.setThinkingLevel(role.thinking);
		registerSkillTool();
		registerRoleSwitchTool();
		const visibility = updateVisibleTools();
		updateDisplay(ctx);
		if (options.persist) persistState();
		const skills = skillLists(role, lastKnownSkills);
		for (const warning of warnings) {
			if (ctx.hasUI) ctx.ui.notify(`[pi-agent-roles] ${warning}`, "warning");
		}
		return {
			warnings,
			applied: {
				model: appliedModel,
				thinking: role.thinking,
				temperature: role.temperature,
				visibleTools: visibility.visibleTools,
				askTools: visibility.askTools,
				requiredSkills: skills.required,
				optionalSkills: skills.optional,
			},
		};
	}

	function registerRoleSwitchTool(): void {
		const role = currentRole();
		if (!role || !state) return;
		const switchableRoles = getAgentSwitchableRoles(discovered.roles, role);
		pi.registerTool({
			name: ROLE_SWITCH_TOOL_NAME,
			label: "Role Switch",
			description: buildRoleSwitchDescription({ currentRole: role, stickyLocked: state.stickyLocked, switchableRoles }),
			parameters: ROLE_SWITCH_PARAMETERS,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const result = executeRoleSwitch(params, state ?? createRoleState(role.name, "restore", false), discovered.roles);
				if (result.details.status === "success" && result.state.activeRole !== state?.activeRole) {
					const applied = await applyRoleState(ctx, result.state, { persist: true });
					result.details.applied = applied.applied;
				}
				const warningText = result.details.status === "success" && result.details.applied?.model === undefined && result.details.summary.startsWith("Activated role")
					? ""
					: "";
				return {
					content: [{ type: "text", text: [result.details.summary, warningText].filter(Boolean).join("\n\n") }],
					details: result.details,
				};
			},
		});
	}

	function registerSkillTool(): void {
		const role = currentRole();
		if (!role) return;
		const execute = createSkillToolHandler({
			getRole: currentRole,
			getActive: () => activeSkillState,
			setActive: (next) => {
				activeSkillState = [...next];
			},
			allSkills: () => lastKnownSkills,
			persist: persistActiveSkills,
		});
		pi.registerTool({
			name: ROLE_SKILL_TOOL_NAME,
			label: "Skill",
			description: buildSkillToolDescription(role, lastKnownSkills),
			parameters: SKILL_TOOL_PARAMETERS,
			async execute(_toolCallId, params) {
				const details = await execute(params as { action?: string; name?: string; query?: string; limit?: number });
				return {
					content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
					details,
				};
			},
		});
	}

	async function reloadRoleRuntime(ctx: ExtensionContext): Promise<{ previousRole?: string; activeRole: string; roleCount: number; roleChanged: boolean }> {
		refreshCatalog(ctx.cwd);
		surfaceDiagnostics(ctx);
		const previousRole = state?.activeRole;
		const nextState = state ?? branchState(ctx, "restore");
		const resolvedState = discovered.roles.some((role) => role.name === nextState.activeRole)
			? nextState
			: branchState(ctx, "restore");
		state = resolvedState;
		await applyRoleState(ctx, resolvedState, { persist: previousRole !== undefined && previousRole !== resolvedState.activeRole });
		return {
			previousRole,
			activeRole: resolvedState.activeRole,
			roleCount: discovered.roles.length,
			roleChanged: previousRole !== undefined && previousRole !== resolvedState.activeRole,
		};
	}

	async function reconcileAfterEdit(ctx: ExtensionContext): Promise<void> {
		await reloadRoleRuntime(ctx);
	}

	async function activateFromUserSelection(ctx: ExtensionContext, roleName: string): Promise<void> {
		const role = discovered.roles.find((entry) => entry.name === roleName);
		if (!role) {
			ctx.ui.notify(`Unknown role ${roleName}.`, "warning");
			return;
		}
		if (role.activation === "agent") {
			ctx.ui.notify(`Role ${role.label} is agent-only and cannot be activated manually.`, "warning");
			return;
		}
		const currentState = state ?? createRoleState(role.name, "user", role.sticky);
		const result = requestUserRoleSwitch(currentState, {
			targetRole: role.name,
			sticky: role.sticky,
			userSwitchMode: loadedConfig?.config.userSwitchMode ?? "end_turn",
			agentIsIdle: ctx.isIdle(),
		});
		state = result.state;
		if (result.applied) {
			await applyRoleState(ctx, result.state, { persist: true });
			ctx.ui.notify(`Activated role ${role.label}.`, "info");
		} else {
			persistState();
			registerSkillTool();
			registerRoleSwitchTool();
			ctx.ui.notify(`Queued role switch to ${role.label} until the agent becomes idle.`, "info");
		}
	}

	pi.registerCommand(ROLE_MANAGER_COMMAND, {
		description: "Open the interactive role manager",
		handler: async (_args, ctx) => {
			refreshCatalog(ctx.cwd);
			surfaceDiagnostics(ctx);
			if (!state) {
				state = branchState(ctx, "restore");
				await applyRoleState(ctx, state, { persist: false });
			}
			while (true) {
				const action = await showRoleManager(ctx, discovered.roles, state);
				if (!action) return;
				if (action.kind === "select" && action.roleName) {
					await activateFromUserSelection(ctx, action.roleName);
					return;
				}
				if (action.kind === "view" && action.roleName) {
					const role = discovered.roles.find((entry) => entry.name === action.roleName);
					if (role) await showRoleDetails(ctx, role, state);
					continue;
				}
				if (action.kind === "create") {
					const changed = await createRoleFlow(ctx, loadedConfig ?? loadRolesConfig(ctx.cwd));
					if (changed) await reconcileAfterEdit(ctx);
					continue;
				}
				if (action.kind === "edit" && action.roleName) {
					const role = discovered.roles.find((entry) => entry.name === action.roleName);
					if (role) {
						const changed = await editRoleFlow(ctx, role);
						if (changed) await reconcileAfterEdit(ctx);
					}
				}
			}
		},
	});

	pi.registerCommand(ROLE_RELOAD_COMMAND, {
		description: "Reload role files and reapply runtime role state",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Waiting for the current agent turn to finish before reloading roles.", "info");
				await ctx.waitForIdle();
			}
			const result = await reloadRoleRuntime(ctx);
			const message = result.roleChanged && result.previousRole
				? `Reloaded ${result.roleCount} roles. Active role changed from ${result.previousRole} to ${result.activeRole}.`
				: `Reloaded ${result.roleCount} roles. Active role: ${result.activeRole}.`;
			ctx.ui.notify(message, "info");
		},
	});

	pi.registerCommand(ROLE_UNSTICK_COMMAND, {
		description: "Clear the sticky lock on the current role",
		handler: async (_args, ctx) => {
			if (!state || !state.stickyLocked) {
				ctx.ui.notify("The current role is not sticky-locked.", "info");
				return;
			}
			state = clearStickyLock(state);
			await applyRoleState(ctx, state, { persist: true });
			ctx.ui.notify(`Removed the sticky lock from ${currentRole()?.label ?? state.activeRole}.`, "info");
		},
	});

	pi.on("resources_discover", () => ({
		skillPaths: [bundledRoleCreatorPath],
	}));

	pi.on("session_start", async (_event, ctx) => {
		activeUiContext = ctx;
		refreshCatalog(ctx.cwd);
		surfaceDiagnostics(ctx);
		if (!shortcutRegistered) {
			pi.registerShortcut((loadedConfig?.config.cycleShortcut ?? "ctrl+r") as never, {
				description: "Cycle user-activatable roles",
				handler: async (shortcutCtx) => {
					refreshCatalog(shortcutCtx.cwd);
					const candidates = discovered.roles
						.filter((role) => role.activation !== "agent")
						.sort((left, right) => left.index - right.index || left.name.localeCompare(right.name));
					if (candidates.length === 0) return;
					const currentIndex = state ? candidates.findIndex((role) => role.name === state?.activeRole) : -1;
					const nextRole = candidates[(currentIndex + 1 + candidates.length) % candidates.length]!;
					await activateFromUserSelection(shortcutCtx, nextRole.name);
				},
			});
			shortcutRegistered = true;
		}
		const branch = ctx.sessionManager.getBranch();
		const restoredState = reconstructRoleState(branch);
		state = branchState(ctx, restoredState ? "restore" : "startup");
		restoreActiveSkillState(branch);
		if (activeSkillState.length === 0) {
			const role = currentRole();
			if (role) {
				activeSkillState = applyRequiredSkills([], role, lastKnownSkills);
				persistActiveSkills();
			}
		}
		await applyRoleState(ctx, state, { persist: !restoredState });
	});

	pi.on("session_tree", async (_event, ctx) => {
		refreshCatalog(ctx.cwd);
		restoreActiveSkillState(ctx.sessionManager.getBranch());
		state = branchState(ctx, "restore");
		await applyRoleState(ctx, state, { persist: false });
	});

	pi.on("before_agent_start", async (event, ctx) => {
		refreshCatalog(ctx.cwd);
		lastKnownSkills = event.systemPromptOptions.skills ?? [];
		const role = currentRole();
		if (!role || !state) return;
		const buildSystemPrompt = await resolveBuildSystemPrompt();
		const baseOptions: BuildSystemPromptOptions = {
			...event.systemPromptOptions,
			skills: [],
		};
		const builtin = buildSystemPrompt(baseOptions);
		const roleStateContext = currentRoleStateContext();
		const inScopeSkills = filterSkillsForRole(lastKnownSkills, role);
		const activeSkillBodies = readActiveSkillBodies(activeSkillState);
		const template = loadSystemPromptTemplate(ctx.cwd);
		const rendered = renderTemplate(template, {
			builtinSystemPrompt: builtin,
			role: {
				name: role.name,
				label: role.label,
				description: role.description,
				triggerDescription: role.triggerDescription ?? "",
				body: currentInstructions(role),
				requiredSkills: role.skills.required,
				optionalSkills: role.skills.optional,
				hiddenSkills: role.skills.hidden,
			},
			availableSkills: inScopeSkills.map((skill) => ({
				name: skill.name,
				description: skill.description ?? "",
				filePath: skill.filePath,
			})),
			activeSkills: activeSkillBodies,
			switchableRoles: getAgentSwitchableRoles(discovered.roles, role).map((switchableRole) => ({
				name: switchableRole.name,
				label: switchableRole.label,
				triggerDescription: switchableRole.triggerDescription ?? "",
			})),
			switching: { allowed: roleSwitchAdvertised(role, state, discovered.roles) },
			state: roleStateContext,
		});
		liveRoleStateContext = roleStateContext;
		registerSkillTool();
		registerRoleSwitchTool();
		updateVisibleTools();
		return {
			systemPrompt: rendered,
		};
	});

	pi.on("context", () => {
		liveRoleStateContext = currentRoleStateContext();
	});

	pi.on("before_provider_request", (event, ctx) => {
		const role = currentRole();
		if (!role || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
		const payloadWithRoleState = injectRoleStateIntoPayload(event.payload, liveRoleStateContext);
		return applyRoleTemperatureToPayload(
			{
				provider: ctx.model?.provider,
				modelId: ctx.model?.id,
				blacklist: loadedConfig?.config.temperatureBlacklist ?? [],
				roleTemperature: role.temperature,
			},
			payloadWithRoleState,
		);
	});

	pi.on("tool_call", async (event, ctx) => {
		const role = currentRole();
		if (!role) return;
		const action = matchToolPolicy(role, event.toolName);
		if (action === "deny") {
			return { block: true, reason: `Tool ${event.toolName} is denied by the active role ${role.name}.` };
		}
		if (action === "ask") {
			if (!ctx.hasUI) {
				return { block: true, reason: `Tool ${event.toolName} requires confirmation in the active role ${role.name}.` };
			}
			const ok = await ctx.ui.confirm("Role tool confirmation", `Allow ${event.toolName} while role ${role.label} is active?`);
			if (!ok) return { block: true, reason: `Tool ${event.toolName} was rejected by the user.` };
		}
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" as const };
		if (!event.text.startsWith("/skill:")) return { action: "continue" as const };
		const role = currentRole();
		if (!role) return { action: "continue" as const };
		const skillName = event.text.slice(7).split(/\s+/, 1)[0]?.trim();
		if (!skillName) return { action: "continue" as const };
		if (matchSkillPolicy(role, skillName) === "hidden") {
			ctx.ui.notify(`Skill ${skillName} is hidden while role ${role.label} is active.`, "warning");
			return { action: "handled" as const };
		}
		return { action: "continue" as const };
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!state?.pendingUserRoleSwitch) return;
		const applied = applyPendingUserRoleSwitch(state);
		if (!applied.applied) return;
		await applyRoleState(ctx, applied.state, { persist: true });
		ctx.ui.notify(`Applied queued role switch to ${currentRole()?.label ?? applied.state.activeRole}.`, "info");
	});

	pi.on("session_shutdown", (_event, ctx) => {
		activeUiContext = undefined;
		fancyEditorReady = false;
		liveRoleStateContext = "";
		unsubscribeFancyEditorReady();
		clearActiveRoleDisplay(pi.events as never);
		if (ctx.hasUI) ctx.ui.setWidget("pi-agent-roles", undefined);
	});
}
