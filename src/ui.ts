import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { resolveRoleManagerLayout } from "./display.js";
import { paintColor } from "./theme.js";
import type { LoadedRolesConfig, ResolvedRole, RoleRuntimeState } from "./types.js";

interface RoleManagerAction {
	kind: "select" | "view" | "create" | "edit";
	roleName?: string;
}

function padAnsi(line: string, width: number): string {
	const truncated = truncateToWidth(line, width, "");
	const remaining = Math.max(0, width - visibleWidth(truncated));
	return truncated + " ".repeat(remaining);
}

function formatList(values: readonly string[]): string {
	return values.length > 0 ? values.join(", ") : "(none)";
}

function toolSummary(role: ResolvedRole): string {
	return [
		`inherit=${role.tools.inherit ? "yes" : "no"}`,
		`allow=${formatList(role.tools.allow)}`,
		`ask=${formatList(role.tools.ask)}`,
		`hidden=${formatList(role.tools.hidden)}`,
	].join("; ");
}

function skillSummary(role: ResolvedRole): string {
	const roots = role.skills.roots.inherit
		? "inherit"
		: role.skills.roots.dirs.length > 0
			? role.skills.roots.dirs.join(", ")
			: "(none)";
	return [
		`roots=${roots}`,
		`inherit_loaded=${role.skills.inheritLoaded ? "yes" : "no"}`,
		`required=${formatList(role.skills.required)}`,
		`optional=${formatList(role.skills.optional)}`,
		`hidden=${formatList(role.skills.hidden)}`,
	].join("; ");
}

export function formatRoleDetails(role: ResolvedRole, state: RoleRuntimeState): string {
	return [
		`Role: ${role.label} (${role.name})`,
		`Description: ${role.description}`,
		`Activation: ${role.activation}`,
		`Sticky default: ${role.sticky ? "yes" : "no"}`,
		`Active sticky lock: ${state.activeRole === role.name && state.stickyLocked ? "yes" : "no"}`,
		`Model: ${role.model.raw}`,
		`Thinking: ${role.thinking ?? "inherit"}`,
		`Temperature: ${role.temperature ?? "inherit"}`,
		`Prompt: ${role.promptMode}`,
		`Tools: ${toolSummary(role)}`,
		`Skills: ${skillSummary(role)}`,
		`File: ${role.filePath}`,
		"",
		role.body || "(no custom body)",
	].join("\n");
}

export async function showRoleDetails(ctx: ExtensionContext, role: ResolvedRole, state: RoleRuntimeState): Promise<void> {
	const content = formatRoleDetails(role, state);
	await ctx.ui.custom<void>((tui, theme, _kb, done) => ({
		render(width: number) {
			const title = theme.fg("accent", theme.bold(`Role details: ${role.label}`));
			const body = wrapTextWithAnsi(content, Math.max(20, width - 2));
			const help = theme.fg("dim", "enter/esc close");
			return [title, "", ...body, "", help].map((line) => truncateToWidth(line, width));
		},
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				done(undefined);
				return;
			}
			tui.requestRender();
		},
	}));
}

export async function showRoleManager(
	ctx: ExtensionContext,
	roles: readonly ResolvedRole[],
	state: RoleRuntimeState,
): Promise<RoleManagerAction | null> {
	if (roles.length === 0) return null;
	return ctx.ui.custom<RoleManagerAction | null>((tui, theme, _kb, done) => {
		let selectedIndex = Math.max(0, roles.findIndex((role) => role.name === state.activeRole));

		const selectedRole = () => roles[Math.max(0, Math.min(selectedIndex, roles.length - 1))]!;
		const renderWide = (width: number): string[] => {
			const leftWidth = Math.min(42, Math.max(24, Math.floor(width * 0.38)));
			const rightWidth = Math.max(20, width - leftWidth - 3);
			const role = selectedRole();
			const left: string[] = [theme.fg("accent", theme.bold("Roles")), ""];
			for (let index = 0; index < roles.length; index += 1) {
				const entry = roles[index]!;
				const prefix = index === selectedIndex ? theme.fg("accent", "> ") : "  ";
				const active = entry.name === state.activeRole ? theme.fg("success", " ●") : "";
				const sticky = entry.name === state.activeRole && state.stickyLocked ? theme.fg("warning", " [sticky]") : "";
				left.push(`${prefix}${entry.label}${active}${sticky}`);
				left.push(theme.fg("muted", `  ${entry.description}`));
			}
			left.push("");
			left.push(theme.fg("dim", "enter select • v view • c create • e edit • esc close"));

			const rightContent = formatRoleDetails(role, state).split("\n");
			const right: string[] = [paintColor(theme as never, role.displayColor, theme.bold(role.label)), ""];
			for (const line of rightContent) right.push(...wrapTextWithAnsi(line, rightWidth));
			const rows = Math.max(left.length, right.length);
			const combined: string[] = [];
			for (let index = 0; index < rows; index += 1) {
				combined.push(`${padAnsi(left[index] ?? "", leftWidth)} ${theme.fg("borderMuted", "│")} ${padAnsi(right[index] ?? "", rightWidth)}`);
			}
			return combined;
		};

		const renderCompact = (width: number): string[] => {
			const role = selectedRole();
			const lines: string[] = [
				theme.fg("accent", theme.bold("Roles")),
				paintColor(theme as never, role.displayColor, `${role.label} (${role.name})`),
				theme.fg("muted", role.description),
				state.activeRole === role.name && state.stickyLocked ? theme.fg("warning", "Sticky lock active") : "",
				"",
			];
			for (let index = 0; index < roles.length; index += 1) {
				const entry = roles[index]!;
				const prefix = index === selectedIndex ? theme.fg("accent", "> ") : "  ";
				const active = entry.name === state.activeRole ? theme.fg("success", " ●") : "";
				lines.push(`${prefix}${entry.label}${active}`);
			}
			lines.push("");
			lines.push(theme.fg("dim", "enter select • v details • c create • e edit • esc close"));
			return lines.filter((line, index) => line !== "" || index < 4).map((line) => truncateToWidth(line, width));
		};

		return {
			render(width: number) {
				return resolveRoleManagerLayout(width) === "wide" ? renderWide(width) : renderCompact(width);
			},
			invalidate() {},
			handleInput(data: string) {
				if (matchesKey(data, Key.up) && selectedIndex > 0) selectedIndex -= 1;
				else if (matchesKey(data, Key.down) && selectedIndex < roles.length - 1) selectedIndex += 1;
				else if (matchesKey(data, Key.pageUp)) selectedIndex = Math.max(0, selectedIndex - 10);
				else if (matchesKey(data, Key.pageDown)) selectedIndex = Math.min(roles.length - 1, selectedIndex + 10);
				else if (matchesKey(data, Key.enter)) done({ kind: "select", roleName: selectedRole().name });
				else if (data === "v") done({ kind: "view", roleName: selectedRole().name });
				else if (data === "c") done({ kind: "create" });
				else if (data === "e") done({ kind: "edit", roleName: selectedRole().name });
				else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(null);
				tui.requestRender();
			},
		};
	});
}

function isValidRoleId(name: string): boolean {
	return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) && !name.includes("--");
}

function buildRoleTemplate(name: string): string {
	return `---
name: ${name}
label: ${name.split("-").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ")}
description: Describe what this role is for.
index: 0
color: accent
activation: both
sticky: false
triggerDescription: Use when this role is the best fit for the task.
triggerGuidelines:
  - Explain what the agent gains from this role.
model: inherit
temperature: inherit
tools:
  inherit: true
skills:
  roots:
    inherit: true
    dirs: []
  inherit_loaded: true
  required: []
  optional: []
  hidden: []
prompt: append
---
Add role-specific instructions here.
`;
}

export async function createRoleFlow(ctx: ExtensionContext, config: LoadedRolesConfig): Promise<boolean> {
	const scope = await ctx.ui.select("Create role in which scope?", ["project", "global"]);
	if (!scope) return false;
	const roleId = await ctx.ui.input("Role id?", "builder");
	if (!roleId) return false;
	const name = roleId.trim();
	if (!isValidRoleId(name)) {
		ctx.ui.notify("Invalid role id. Use lowercase letters, numbers, and hyphens.", "warning");
		return false;
	}
	const root = scope === "project" ? config.projectRoots[0] : config.globalRoots[0];
	if (!root) {
		ctx.ui.notify(`No ${scope} role root is available.`, "warning");
		return false;
	}
	const path = join(root, `${name}.md`);
	const edited = await ctx.ui.editor(`Create role: ${name}`, buildRoleTemplate(name));
	if (edited === undefined) return false;
	await writeFile(path, edited, "utf8");
	ctx.ui.notify(`Saved ${scope} role to ${path}`, "info");
	return true;
}

export async function editRoleFlow(ctx: ExtensionContext, role: ResolvedRole): Promise<boolean> {
	if (role.scope === "builtin" || role.filePath.startsWith("<builtin:")) {
		ctx.ui.notify("The built-in fallback role cannot be edited. Create a file-backed role instead.", "warning");
		return false;
	}
	const current = await readFile(role.filePath, "utf8");
	const edited = await ctx.ui.editor(`Edit role: ${role.label}`, current);
	if (edited === undefined) return false;
	await writeFile(role.filePath, edited, "utf8");
	ctx.ui.notify(`Updated role file ${role.filePath}`, "info");
	return true;
}
