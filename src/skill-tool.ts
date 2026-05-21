import { parseFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "typebox";
import { filterSkillsForRole } from "./prompt.js";
import { type ActiveSkill } from "./skill-runtime.js";
import { createSkillSearchIndex } from "./skill-search.js";
import type { ResolvedRole } from "./types.js";

export const SKILL_TOOL_PARAMETERS = Type.Object({
	action: Type.Union([
		Type.Literal("search"),
		Type.Literal("activate"),
		Type.Literal("deactivate"),
		Type.Literal("info"),
	]),
	name: Type.Optional(Type.String()),
	query: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

type SkillsSource = readonly Skill[] | (() => readonly Skill[]);

export type SkillToolContext = {
	getRole: () => ResolvedRole | undefined;
	getActive: () => readonly ActiveSkill[];
	setActive: (next: ActiveSkill[]) => void;
	allSkills: SkillsSource;
	persist: () => void;
};

type SkillToolParams = {
	action?: "search" | "activate" | "deactivate" | "info" | string;
	name?: string;
	query?: string;
	limit?: number;
};

function currentSkills(source: SkillsSource): readonly Skill[] {
	return typeof source === "function" ? source() : source;
}

function getInScopeSkills(ctx: SkillToolContext): Skill[] {
	const role = ctx.getRole();
	if (!role) return [];
	return filterSkillsForRole(currentSkills(ctx.allSkills), role);
}

function findSkillByName(skills: readonly Skill[], name: string | undefined): Skill | undefined {
	if (!name) return undefined;
	return skills.find((skill) => skill.name === name);
}

function activeEntryFor(skill: Skill, current?: ActiveSkill): ActiveSkill {
	return {
		name: skill.name,
		filePath: skill.filePath,
		contentHash: current?.contentHash ?? "",
	};
}

export function summarizeSkillScope(role: ResolvedRole | undefined, skills: readonly Skill[]): string {
	if (!role) return "No active role is available right now.";
	const inScope = filterSkillsForRole(skills, role);
	if (inScope.length === 0) return `Current role: \`${role.name}\`. No in-scope skills are currently available.`;
	const preview = inScope.slice(0, 12).map((skill) => `\`${skill.name}\``).join(", ");
	const remainder = inScope.length > 12 ? ` (+${inScope.length - 12} more)` : "";
	return `Current role: \`${role.name}\`. In-scope skills (${inScope.length}): ${preview}${remainder}.`;
}

export function buildSkillToolDescription(role: ResolvedRole | undefined, skills: readonly Skill[]): string {
	return [
		"Search, activate, deactivate, or inspect skills that are in scope for the current role.",
		summarizeSkillScope(role, skills),
	].join(" ");
}

export function createSkillToolHandler(ctx: SkillToolContext) {
	return async (params: SkillToolParams) => {
		switch (params.action) {
			case "search": {
				const query = params.query?.trim();
				if (!query) return { error: "query required" };
				const hits = createSkillSearchIndex(getInScopeSkills(ctx)).search(query, { limit: params.limit });
				return { hits };
			}
			case "activate": {
				if (!params.name?.trim()) return { error: "name required" };
				const skill = findSkillByName(getInScopeSkills(ctx), params.name.trim());
				if (!skill) return { error: "skill not in scope" };
				const active = [...ctx.getActive()];
				const existing = active.find((entry) => entry.name === skill.name || resolve(entry.filePath) === resolve(skill.filePath));
				if (!existing) {
					ctx.setActive([...active, activeEntryFor(skill)]);
					ctx.persist();
				}
				return { activated: skill.name };
			}
			case "deactivate": {
				if (!params.name?.trim()) return { error: "name required" };
				const name = params.name.trim();
				const active = [...ctx.getActive()];
				const next = active.filter((entry) => entry.name !== name);
				if (next.length !== active.length) {
					ctx.setActive(next);
					ctx.persist();
				}
				return { deactivated: name };
			}
			case "info": {
				if (!params.name?.trim()) return { error: "name required" };
				const skill = findSkillByName(getInScopeSkills(ctx), params.name.trim());
				if (!skill) return { error: "skill not in scope" };
				const raw = readFileSync(skill.filePath, "utf8");
				const { frontmatter } = parseFrontmatter<Record<string, unknown>>(raw);
				return {
					info: {
						frontmatter,
						filePath: skill.filePath,
						description: skill.description,
					},
				};
			}
			default:
				return { error: "unknown action" };
		}
	};
}
