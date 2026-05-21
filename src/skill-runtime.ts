import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const PER_SKILL_BODY_LIMIT = 8 * 1024;
const TOTAL_ACTIVE_SKILL_BODY_LIMIT = 32 * 1024;
const TRUNCATED_MARKER = "[truncated]";

type SkillPolicyAction = "required" | "optional" | "hidden";

type SkillRule = {
	pattern: string;
	action: SkillPolicyAction;
};

type RoleLike = {
	skills: {
		roots: {
			inherit: boolean;
			dirs: string[];
		};
		inheritLoaded: boolean;
		required: string[];
		hidden?: string[];
		rules?: readonly SkillRule[];
	};
};

type SkillLike = {
	name: string;
	filePath: string;
	contentHash?: string;
};

export type ActiveSkill = {
	name: string;
	filePath: string;
	contentHash: string;
};

export type ActiveSkillBody = {
	name: string;
	filePath: string;
	body: string;
};

function byteLength(input: string): number {
	return Buffer.byteLength(input, "utf8");
}

function trimToMaxBytes(input: string, maxBytes: number): string {
	if (maxBytes <= 0) return "";
	if (byteLength(input) <= maxBytes) return input;
	let end = input.length;
	while (end > 0 && byteLength(input.slice(0, end)) > maxBytes) end -= 1;
	return input.slice(0, end);
}

function truncateToBytes(input: string, maxBytes: number, forceMarker = false): string {
	if (maxBytes <= 0) return "";
	if (byteLength(input) <= maxBytes && (!forceMarker || input.endsWith(TRUNCATED_MARKER))) return input;
	const markerBytes = byteLength(TRUNCATED_MARKER);
	if (maxBytes <= markerBytes) return trimToMaxBytes(TRUNCATED_MARKER, maxBytes);
	return `${trimToMaxBytes(input, maxBytes - markerBytes)}${TRUNCATED_MARKER}`;
}

function patternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

function matchesAnyPattern(name: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) => patternToRegExp(pattern).test(name));
}

function isPathWithinRoot(path: string, root: string): boolean {
	const relativePath = relative(resolve(root), resolve(path));
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function lastMatchingAction(rules: readonly SkillRule[] | undefined, name: string): SkillPolicyAction | undefined {
	let action = rules?.[0]?.action;
	for (const rule of rules ?? []) {
		if (patternToRegExp(rule.pattern).test(name)) action = rule.action;
	}
	return action;
}

function isSkillHidden(role: RoleLike, skillName: string): boolean {
	if (role.skills.rules && role.skills.rules.length > 0) {
		return lastMatchingAction(role.skills.rules, skillName) === "hidden";
	}
	return matchesAnyPattern(skillName, role.skills.hidden ?? []);
}

function isSkillInScope(role: RoleLike, skill: SkillLike): boolean {
	const inScopeRoot = role.skills.roots.inherit
		|| role.skills.roots.dirs.some((root) => isPathWithinRoot(skill.filePath, root));
	return inScopeRoot && !isSkillHidden(role, skill.name);
}

export function applyRequiredSkills(
	activeSet: readonly ActiveSkill[],
	role: RoleLike,
	allSkills: readonly SkillLike[],
): ActiveSkill[] {
	const next = [...activeSet];
	const activeNames = new Set(activeSet.map((skill) => skill.name));
	const activePaths = new Set(activeSet.map((skill) => resolve(skill.filePath)));
	for (const skill of allSkills) {
		if (!matchesAnyPattern(skill.name, role.skills.required)) continue;
		if (!isSkillInScope(role, skill)) continue;
		const resolvedPath = resolve(skill.filePath);
		if (activeNames.has(skill.name) || activePaths.has(resolvedPath)) continue;
		next.push({
			name: skill.name,
			filePath: skill.filePath,
			contentHash: skill.contentHash ?? "",
		});
		activeNames.add(skill.name);
		activePaths.add(resolvedPath);
	}
	return next;
}

export function applyInheritLoaded(prevActive: readonly ActiveSkill[], role: RoleLike): ActiveSkill[] {
	return role.skills.inheritLoaded ? (prevActive as ActiveSkill[]) : [];
}

export function readActiveSkillBodies(activeSet: readonly ActiveSkill[]): ActiveSkillBody[] {
	const bodies: ActiveSkillBody[] = [];
	let totalBytes = 0;

	for (let index = 0; index < activeSet.length; index += 1) {
		const skill = activeSet[index];
		const fileBody = readFileSync(skill.filePath, "utf8");
		const perSkillBody = truncateToBytes(fileBody, PER_SKILL_BODY_LIMIT);
		const remainingBytes = TOTAL_ACTIVE_SKILL_BODY_LIMIT - totalBytes;
		if (remainingBytes <= 0) {
			const lastBody = bodies.at(-1);
			if (lastBody) lastBody.body = truncateToBytes(lastBody.body, byteLength(lastBody.body), true);
			break;
		}
		const hasMoreSkills = index < activeSet.length - 1;
		const body = truncateToBytes(
			perSkillBody,
			remainingBytes,
			byteLength(perSkillBody) >= remainingBytes && hasMoreSkills,
		);
		if (body.length === 0) {
			const lastBody = bodies.at(-1);
			if (lastBody) lastBody.body = truncateToBytes(lastBody.body, byteLength(lastBody.body), true);
			break;
		}
		bodies.push({ name: skill.name, filePath: skill.filePath, body });
		totalBytes += byteLength(body);
		if (totalBytes >= TOTAL_ACTIVE_SKILL_BODY_LIMIT) break;
	}

	return bodies;
}
