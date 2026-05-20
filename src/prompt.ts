import type { Skill } from "@earendil-works/pi-coding-agent";
import type { ResolvedRole } from "./types.js";
import { matchSkillPolicy } from "./policy.js";

function escapeXml(input: string): string {
	return input
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export function formatRolesSystemPrompt(options: {
	currentRole: ResolvedRole;
	switchableRoles: readonly ResolvedRole[];
	stickyLocked: boolean;
}): string {
	const lines = [
		"## Roles",
		`Current role: \`${options.currentRole.name}\` (${options.currentRole.label})`,
	];
	if (options.currentRole.triggerDescription) {
		lines.push(`Current role guidance: ${options.currentRole.triggerDescription}`);
	}
	if (options.stickyLocked) {
		lines.push("Agent role switching is unavailable because the current role is sticky-locked by the user.");
	}
	if (options.switchableRoles.length === 0) {
		lines.push("No alternative agent-switchable roles are available right now.");
	} else {
		lines.push("Agent-switchable roles right now:");
		for (const role of options.switchableRoles) {
			lines.push(`- \`${role.name}\` (${role.label}): ${role.triggerDescription ?? role.description}`);
		}
	}
	return lines.join("\n");
}

export function buildRoleStateContext(options: {
	currentRole: ResolvedRole;
	activationSource: "startup" | "restore" | "user" | "agent";
	stickyLocked: boolean;
	switchingAllowed: boolean;
	requiredSkills: readonly string[];
	optionalSkills: readonly string[];
	reminder?: string;
}): string {
	const lines: string[] = [];
	if (options.reminder) lines.push(options.reminder);
	lines.push("<role-state>");
	lines.push(
		`  <current-role id="${escapeXml(options.currentRole.name)}" label="${escapeXml(options.currentRole.label)}" source="${options.activationSource}" sticky="${options.stickyLocked ? "true" : "false"}" />`,
	);
	lines.push(
		`  <switching allowed="${options.switchingAllowed ? "true" : "false"}">${options.switchingAllowed ? "Use `role_switch` only when another listed role is a better fit." : "Role switching is currently unavailable."}</switching>`,
	);
	lines.push(`  <instructions mode="${options.currentRole.promptMode}">${escapeXml(options.currentRole.body)}</instructions>`);
	if (options.requiredSkills.length > 0 || options.optionalSkills.length > 0) {
		lines.push("  <skills>");
		for (const skill of options.requiredSkills) lines.push(`    <required>${escapeXml(skill)}</required>`);
		for (const skill of options.optionalSkills) lines.push(`    <optional>${escapeXml(skill)}</optional>`);
		lines.push("  </skills>");
	}
	lines.push("</role-state>");
	return lines.join("\n");
}

export function filterHiddenSkillsFromPrompt(systemPrompt: string, skills: readonly Skill[], role: ResolvedRole): string {
	const hiddenPaths = new Set(
		skills.filter((skill) => matchSkillPolicy(role, skill.name) === "hidden").map((skill) => skill.filePath),
	);
	if (hiddenPaths.size === 0) return systemPrompt;
	return systemPrompt.replace(/\n?\s*<skill>\n[\s\S]*?\n\s*<\/skill>/g, (block) => {
		const locationMatch = block.match(/<location>([\s\S]*?)<\/location>/);
		if (!locationMatch) return block;
		const location = locationMatch[1]
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&quot;", '"')
			.replaceAll("&apos;", "'")
			.replaceAll("&amp;", "&");
		return hiddenPaths.has(location) ? "" : block;
	});
}
