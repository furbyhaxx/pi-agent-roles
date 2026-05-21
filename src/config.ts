import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { LoadedRolesConfig, RolesConfig, UserSwitchMode } from "./types.js";

interface RawRolesConfig {
	default?: unknown;
	roots?: unknown;
	cycleShortcut?: unknown;
	userSwitchMode?: unknown;
	showWidgetWhenFancyEditorMissing?: unknown;
	temperatureBlacklist?: unknown;
}

interface RawAskConfig {
	primaryToolArgs?: unknown;
}

export type AskPrimaryToolArg = string | false;

export interface LoadedAskConfig {
	primaryToolArgs: Record<string, AskPrimaryToolArg>;
	sources: string[];
}

export class SettingsJsonParseError extends Error {
	override cause: unknown;
	readonly path: string;

	constructor(path: string, cause: unknown) {
		super(`Invalid JSON in settings file: ${path}`);
		this.name = "SettingsJsonParseError";
		this.cause = cause;
		this.path = path;
	}
}

export const DEFAULT_ROLES_CONFIG: RolesConfig = {
	defaultRole: undefined,
	roots: [],
	cycleShortcut: "ctrl+r",
	userSwitchMode: "end_turn",
	showWidgetWhenFancyEditorMissing: true,
	temperatureBlacklist: ["openai-codex/*"],
};

export const DEFAULT_ASK_PRIMARY_TOOL_ARGS: Record<string, string> = {
	bash: "command",
	write: "path",
	edit: "path",
	read: "path",
	grep: "pattern",
	find: "pattern",
	ls: "path",
	web_fetch: "url",
	shell_exec: "command",
	shell_write_stdin: "chars",
	shell_kill_session: "session_id",
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

function readSettingsJsonOrThrow(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		return asRecord(JSON.parse(readFileSync(path, "utf8")));
	} catch (cause) {
		throw new SettingsJsonParseError(path, cause);
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

function normalizeTemperatureBlacklist(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const patterns = value
		.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
		.map((entry) => entry.trim());
	return [...new Set(patterns)];
}

function normalizePrimaryToolArgs(value: unknown): Record<string, AskPrimaryToolArg> {
	const normalized: Record<string, AskPrimaryToolArg> = {};
	for (const [key, entry] of Object.entries(asRecord(value))) {
		if (typeof entry === "string" || entry === false) normalized[key] = entry;
	}
	return normalized;
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

function writeSettingsJsonAtomic(path: string, data: Record<string, unknown>): void {
	const tempPath = `${path}.tmp`;
	mkdirSync(dirname(path), { recursive: true });
	let renamed = false;
	try {
		writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
		renameSync(tempPath, path);
		renamed = true;
	} finally {
		if (!renamed && existsSync(tempPath)) {
			try {
				unlinkSync(tempPath);
			} catch {
				// best-effort temp cleanup
			}
		}
	}
}

export function loadAskConfig(cwd: string, options?: { agentDir?: string }): LoadedAskConfig {
	const agentDir = options?.agentDir ?? getAgentDir();
	const globalSettingsPath = join(agentDir, "settings.json");
	const projectSettingsPath = join(cwd, ".pi", "settings.json");
	const globalAsk = asRecord(asRecord(readSettingsJson(globalSettingsPath).roles).ask) as RawAskConfig;
	const projectAsk = asRecord(asRecord(readSettingsJson(projectSettingsPath).roles).ask) as RawAskConfig;

	return {
		primaryToolArgs: {
			...DEFAULT_ASK_PRIMARY_TOOL_ARGS,
			...normalizePrimaryToolArgs(globalAsk.primaryToolArgs),
			...normalizePrimaryToolArgs(projectAsk.primaryToolArgs),
		},
		sources: [globalSettingsPath, projectSettingsPath].filter((path) => existsSync(path)),
	};
}

export function saveAskPrimaryToolArg(
	toolName: string,
	primaryArg: string,
	options: { scope: "global" | "project"; agentDir?: string; cwd?: string },
): void {
	const targetPath = options.scope === "project"
		? join(options.cwd ?? (() => {
			throw new Error("cwd is required when scope is 'project'");
		})(), ".pi", "settings.json")
		: join(options.agentDir ?? getAgentDir(), "settings.json");
	const settings = readSettingsJsonOrThrow(targetPath);
	const roles = asRecord(settings.roles);
	const ask = asRecord(roles.ask);

	writeSettingsJsonAtomic(targetPath, {
		...settings,
		roles: {
			...roles,
			ask: {
				...ask,
				primaryToolArgs: {
					...normalizePrimaryToolArgs(ask.primaryToolArgs),
					[toolName]: primaryArg,
				},
			},
		},
	});
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
		temperatureBlacklist: projectRoles.temperatureBlacklist !== undefined
			? normalizeTemperatureBlacklist(projectRoles.temperatureBlacklist) ?? DEFAULT_ROLES_CONFIG.temperatureBlacklist
			: globalRoles.temperatureBlacklist !== undefined
				? normalizeTemperatureBlacklist(globalRoles.temperatureBlacklist) ?? DEFAULT_ROLES_CONFIG.temperatureBlacklist
				: DEFAULT_ROLES_CONFIG.temperatureBlacklist,
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
