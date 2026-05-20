import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { LoadedRolesConfig, RolesConfig, UserSwitchMode } from "./types.js";

interface RawRolesConfig {
	default?: unknown;
	roots?: unknown;
	cycleShortcut?: unknown;
	userSwitchMode?: unknown;
	showWidgetWhenFancyEditorMissing?: unknown;
}

export const DEFAULT_ROLES_CONFIG: RolesConfig = {
	defaultRole: undefined,
	roots: [],
	cycleShortcut: "ctrl+r",
	userSwitchMode: "end_turn",
	showWidgetWhenFancyEditorMissing: true,
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readSettingsJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		return asRecord(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return {};
	}
}

function normalizeDefaultRole(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeShortcut(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeUserSwitchMode(value: unknown): UserSwitchMode | undefined {
	return value === "instant" || value === "end_turn" ? value : undefined;
}

function normalizeWidgetFallback(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function expandEnvironment(input: string): string {
	return input.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (_match, braced, bare) => {
		const key = (braced ?? bare) as string;
		return process.env[key] ?? "";
	});
}

export function resolveConfiguredPath(input: string, cwd: string): string {
	let expanded = expandEnvironment(input.trim());
	if (expanded === "~") expanded = homedir();
	else if (expanded.startsWith("~/")) expanded = join(homedir(), expanded.slice(2));
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function normalizeRoots(value: unknown, cwd: string): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const roots = value
		.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
		.map((entry) => resolveConfiguredPath(entry, cwd));
	return [...new Set(roots)];
}

export function loadRolesConfig(cwd: string, options?: { agentDir?: string }): LoadedRolesConfig {
	const agentDir = options?.agentDir ?? getAgentDir();
	const globalSettingsPath = join(agentDir, "settings.json");
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalRoles = asRecord(readSettingsJson(globalSettingsPath).roles) as RawRolesConfig;
	const projectRoles = asRecord(readSettingsJson(projectSettingsPath).roles) as RawRolesConfig;

	const globalRootsConfig = normalizeRoots(globalRoles.roots, cwd) ?? [];
	const projectRootsConfig = normalizeRoots(projectRoles.roots, cwd) ?? [];
	const defaultRoots = [join(agentDir, "roles"), join(cwd, ".pi", "roles")];
	const globalRoots = [...new Set([defaultRoots[0]!, ...globalRootsConfig])];
	const projectRoots = [...new Set([defaultRoots[1]!, ...projectRootsConfig])];

	const config: RolesConfig = {
		defaultRole: projectRoles.default !== undefined
			? normalizeDefaultRole(projectRoles.default)
			: globalRoles.default !== undefined
				? normalizeDefaultRole(globalRoles.default)
				: DEFAULT_ROLES_CONFIG.defaultRole,
		roots: projectRoles.roots !== undefined
			? normalizeRoots(projectRoles.roots, cwd) ?? DEFAULT_ROLES_CONFIG.roots
			: globalRoles.roots !== undefined
				? normalizeRoots(globalRoles.roots, cwd) ?? DEFAULT_ROLES_CONFIG.roots
				: DEFAULT_ROLES_CONFIG.roots,
		cycleShortcut: projectRoles.cycleShortcut !== undefined
			? normalizeShortcut(projectRoles.cycleShortcut) ?? DEFAULT_ROLES_CONFIG.cycleShortcut
			: globalRoles.cycleShortcut !== undefined
				? normalizeShortcut(globalRoles.cycleShortcut) ?? DEFAULT_ROLES_CONFIG.cycleShortcut
				: DEFAULT_ROLES_CONFIG.cycleShortcut,
		userSwitchMode: projectRoles.userSwitchMode !== undefined
			? normalizeUserSwitchMode(projectRoles.userSwitchMode) ?? DEFAULT_ROLES_CONFIG.userSwitchMode
			: globalRoles.userSwitchMode !== undefined
				? normalizeUserSwitchMode(globalRoles.userSwitchMode) ?? DEFAULT_ROLES_CONFIG.userSwitchMode
				: DEFAULT_ROLES_CONFIG.userSwitchMode,
		showWidgetWhenFancyEditorMissing: projectRoles.showWidgetWhenFancyEditorMissing !== undefined
			? normalizeWidgetFallback(projectRoles.showWidgetWhenFancyEditorMissing) ?? DEFAULT_ROLES_CONFIG.showWidgetWhenFancyEditorMissing
			: globalRoles.showWidgetWhenFancyEditorMissing !== undefined
				? normalizeWidgetFallback(globalRoles.showWidgetWhenFancyEditorMissing) ?? DEFAULT_ROLES_CONFIG.showWidgetWhenFancyEditorMissing
				: DEFAULT_ROLES_CONFIG.showWidgetWhenFancyEditorMissing,
	};

	return {
		config,
		defaultRoots,
		globalRoots,
		projectRoots,
		allRoots: [...new Set([...globalRoots, ...projectRoots])],
		sources: [globalSettingsPath, projectSettingsPath].filter((path) => existsSync(path)),
	};
}
