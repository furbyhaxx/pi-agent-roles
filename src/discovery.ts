import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { resolveDisplayColor } from "./colors.js";
import type {
	DiscoverRolesResult,
	ModelSelection,
	ResolvedRole,
	RoleActivation,
	RoleDiagnostic,
	RolePromptMode,
	SkillPolicyAction,
	SkillPolicyRule,
	ThinkingLevel,
	ToolPolicyAction,
	ToolPolicyRule,
} from "./types.js";

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

interface RawRoleFrontmatter extends Record<string, unknown> {
	name?: unknown;
	label?: unknown;
	description?: unknown;
	index?: unknown;
	color?: unknown;
	activation?: unknown;
	sticky?: unknown;
	triggerDescription?: unknown;
	triggerGuidelines?: unknown;
	model?: unknown;
	thinking?: unknown;
	temperature?: unknown;
	tools?: unknown;
	skills?: unknown;
	prompt?: unknown;
	metadata?: unknown;
}

function isValidRoleName(name: string): boolean {
	return NAME_PATTERN.test(name) && !name.includes("--");
}

function normalizeIndex(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return 0;
}

function normalizeActivation(value: unknown): RoleActivation {
	return value === "user" || value === "agent" || value === "both" ? value : "both";
}

function normalizeThinking(value: unknown): ThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	return THINKING_LEVELS.has(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

function parseModelSelection(value: unknown, diagnostics: RoleDiagnostic[], path: string): ModelSelection {
	if (value === undefined || value === null || value === "inherit") {
		return { raw: "inherit", inherit: true };
	}
	if (typeof value !== "string" || value.trim() === "") {
		diagnostics.push({ level: "warning", message: "invalid model value; falling back to inherit", path });
		return { raw: "inherit", inherit: true };
	}
	const raw = value.trim();
	const slash = raw.indexOf("/");
	if (slash === -1) {
		diagnostics.push({ level: "warning", message: `invalid model \"${raw}\"; falling back to inherit`, path });
		return { raw: "inherit", inherit: true };
	}
	const provider = raw.slice(0, slash).trim();
	const modelWithThinking = raw.slice(slash + 1).trim();
	const colon = modelWithThinking.lastIndexOf(":");
	const modelId = colon === -1 ? modelWithThinking : modelWithThinking.slice(0, colon).trim();
	const inlineThinking = colon === -1 ? undefined : normalizeThinking(modelWithThinking.slice(colon + 1).trim());
	return {
		raw,
		provider,
		modelId,
		inlineThinking,
		inherit: false,
	};
}

function normalizeTemperature(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "inherit") return undefined;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function normalizeStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim());
	if (typeof value === "string") {
		return value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
	}
	return [];
}

function normalizeToolRules(value: unknown): ToolPolicyRule[] {
	if (value === undefined || value === null) return [{ pattern: "*", action: "allow" }];
	if (value === "all") return [{ pattern: "*", action: "allow" }];
	const shorthand = normalizeStringArray(value);
	if (shorthand.length > 0) {
		return [{ pattern: "*", action: "deny" }, ...shorthand.map((pattern) => ({ pattern, action: "allow" as const }))];
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const rules: ToolPolicyRule[] = [];
		for (const [pattern, action] of Object.entries(value as Record<string, unknown>)) {
			if (action === "allow" || action === "ask" || action === "deny") {
				rules.push({ pattern, action });
			}
		}
		return rules.length > 0 ? rules : [{ pattern: "*", action: "allow" }];
	}
	return [{ pattern: "*", action: "allow" }];
}

function normalizeSkillRules(value: unknown): { rules: SkillPolicyRule[]; hasExplicitSkills: boolean } {
	if (value === undefined || value === null) {
		return { rules: [{ pattern: "*", action: "optional" }], hasExplicitSkills: false };
	}
	const shorthand = normalizeStringArray(value);
	if (shorthand.length > 0) {
		return {
			rules: [{ pattern: "*", action: "hidden" }, ...shorthand.map((pattern) => ({ pattern, action: "required" as const }))],
			hasExplicitSkills: true,
		};
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const rules: SkillPolicyRule[] = [];
		for (const [pattern, action] of Object.entries(value as Record<string, unknown>)) {
			if (action === "required" || action === "optional" || action === "hidden") {
				rules.push({ pattern, action });
			}
		}
		return {
			rules: rules.length > 0 ? rules : [{ pattern: "*", action: "optional" }],
			hasExplicitSkills: true,
		};
	}
	return { rules: [{ pattern: "*", action: "optional" }], hasExplicitSkills: false };
}

function normalizePromptMode(value: unknown): RolePromptMode {
	return value === "replace" ? "replace" : "append";
}

function normalizeTriggerGuidelines(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim())
		: [];
}

function fallbackRole(agentDir: string): ResolvedRole {
	const diagnostics: RoleDiagnostic[] = [];
	return {
		name: "builder",
		label: "Builder",
		description: "General-purpose fallback role.",
		index: 0,
		displayColor: resolveDisplayColor("builder", "orange", { agentDir, diagnostics }),
		activation: "both",
		sticky: false,
		triggerDescription: "Use for general coding and implementation work when no specialized role is a better fit.",
		triggerGuidelines: ["Full tool access.", "No specialization constraints."],
		model: { raw: "inherit", inherit: true },
		thinking: undefined,
		temperature: undefined,
		tools: [{ pattern: "*", action: "allow" }],
		skills: [{ pattern: "*", action: "optional" }],
		hasExplicitSkills: false,
		promptMode: "append",
		body: "",
		filePath: "<builtin:builder>",
		scope: "builtin",
		agentSwitchable: true,
	};
}

function walkMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop()!;
		let entries: string[] = [];
		try {
			entries = readdirSync(current).sort();
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = join(current, entry);
			let stat;
			try {
				stat = statSync(path);
			} catch {
				continue;
			}
			if (stat.isDirectory()) stack.push(path);
			else if (stat.isFile() && entry.toLowerCase().endsWith(".md")) files.push(path);
		}
	}
	return files.sort();
}

function parseRoleFile(path: string, scope: "global" | "project", agentDir: string): { role?: ResolvedRole; diagnostics: RoleDiagnostic[] } {
	const diagnostics: RoleDiagnostic[] = [];
	try {
		const raw = readFileSync(path, "utf8");
		if (raw.startsWith("---") && !/^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/.test(raw)) {
			throw new Error("missing closing frontmatter delimiter");
		}
		const parsed = parseFrontmatter<RawRoleFrontmatter>(raw);
		const frontmatter = parsed.frontmatter;
		const name = typeof frontmatter.name === "string" && frontmatter.name.trim() !== ""
			? frontmatter.name.trim()
			: basename(path, ".md");
		if (!isValidRoleName(name)) {
			return { diagnostics: [{ level: "warning", message: `invalid role name \"${name}\"`, path }] };
		}

		const model = parseModelSelection(frontmatter.model, diagnostics, path);
		const explicitThinking = normalizeThinking(frontmatter.thinking);
		const thinking = explicitThinking ?? model.inlineThinking;
		const { rules: skills, hasExplicitSkills } = normalizeSkillRules(frontmatter.skills);
		const activation = normalizeActivation(frontmatter.activation);
		const triggerDescription = typeof frontmatter.triggerDescription === "string" && frontmatter.triggerDescription.trim() !== ""
			? frontmatter.triggerDescription.trim()
			: undefined;
		const sticky = typeof frontmatter.sticky === "boolean" ? frontmatter.sticky : false;
		const resolvedSticky = activation === "agent" && sticky ? false : sticky;
		if (activation === "agent" && sticky) {
			diagnostics.push({ level: "warning", message: "sticky=true is ignored for agent-only roles", path });
		}
		const agentSwitchable = activation !== "user" && Boolean(triggerDescription);
		if (activation !== "user" && !triggerDescription) {
			diagnostics.push({ level: "warning", message: "triggerDescription is required for agent-switchable roles; keeping the role user-only for switching", path });
		}

		return {
			role: {
				name,
				label: typeof frontmatter.label === "string" && frontmatter.label.trim() !== "" ? frontmatter.label.trim() : name,
				description: typeof frontmatter.description === "string" && frontmatter.description.trim() !== ""
					? frontmatter.description.trim()
					: name,
				index: normalizeIndex(frontmatter.index),
				displayColor: resolveDisplayColor(name, frontmatter.color, { agentDir, diagnostics, path }),
				activation,
				sticky: resolvedSticky,
				triggerDescription,
				triggerGuidelines: normalizeTriggerGuidelines(frontmatter.triggerGuidelines),
				model,
				thinking,
				temperature: normalizeTemperature(frontmatter.temperature),
				tools: normalizeToolRules(frontmatter.tools),
				skills,
				hasExplicitSkills,
				promptMode: normalizePromptMode(frontmatter.prompt),
				body: parsed.body.trim(),
				filePath: path,
				scope,
				agentSwitchable,
			},
			diagnostics,
		};
	} catch (error) {
		return {
			diagnostics: [{
				level: "warning",
				message: `failed to parse role frontmatter: ${error instanceof Error ? error.message : String(error)}`,
				path,
			}],
		};
	}
}

export function discoverRoles(options: { globalRoots: string[]; projectRoots: string[]; agentDir?: string }): DiscoverRolesResult {
	const agentDir = options.agentDir ?? getAgentDir();
	const diagnostics: RoleDiagnostic[] = [];
	const projectRoles = new Map<string, ResolvedRole>();
	const globalRoles = new Map<string, ResolvedRole>();

	for (const root of options.globalRoots) {
		for (const path of walkMarkdownFiles(root)) {
			const result = parseRoleFile(path, "global", agentDir);
			diagnostics.push(...result.diagnostics);
			if (!result.role) continue;
			if (globalRoles.has(result.role.name)) {
				diagnostics.push({ level: "warning", message: `role name collision for \"${result.role.name}\" in global scope; keeping the first discovered file`, path });
				continue;
			}
			globalRoles.set(result.role.name, result.role);
		}
	}

	for (const root of options.projectRoots) {
		for (const path of walkMarkdownFiles(root)) {
			const result = parseRoleFile(path, "project", agentDir);
			diagnostics.push(...result.diagnostics);
			if (!result.role) continue;
			if (projectRoles.has(result.role.name)) {
				diagnostics.push({ level: "warning", message: `role name collision for \"${result.role.name}\" in project scope; keeping the first discovered file`, path });
				continue;
			}
			if (globalRoles.has(result.role.name)) {
				diagnostics.push({ level: "warning", message: `role name collision for \"${result.role.name}\" across scopes; project scope wins`, path });
			}
			projectRoles.set(result.role.name, result.role);
		}
	}

	const roles = [...[...globalRoles.values()].filter((role) => !projectRoles.has(role.name)), ...projectRoles.values()]
		.sort((left, right) => left.index - right.index || left.name.localeCompare(right.name));

	return {
		roles: roles.length > 0 ? roles : [fallbackRole(agentDir)],
		diagnostics,
	};
}
