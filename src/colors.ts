import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RoleDiagnostic } from "./types.js";

const THEME_TOKENS = new Set(["accent", "success", "warning", "error", "muted", "dim", "text"]);
const COLOR_CACHE_FILE = "role-colors.json";

export const BUILTIN_COLOR_ALIASES: Record<string, string> = {
	orange: "#f97316",
	red: "#ef4444",
	green: "#22c55e",
	teal: "#14b8a6",
	blue: "#3b82f6",
	purple: "#8b5cf6",
	pink: "#ec4899",
	yellow: "#eab308",
	cyan: "#06b6d4",
};

function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}

function hashRoleName(name: string): number {
	let hash = 0;
	for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return hash;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
	const s = saturation / 100;
	const l = lightness / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = l - c / 2;

	let r = 0;
	let g = 0;
	let b = 0;
	if (hue < 60) [r, g, b] = [c, x, 0];
	else if (hue < 120) [r, g, b] = [x, c, 0];
	else if (hue < 180) [r, g, b] = [0, c, x];
	else if (hue < 240) [r, g, b] = [0, x, c];
	else if (hue < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];

	const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function generatedColor(name: string): string {
	const hash = hashRoleName(name);
	return hslToHex(hash % 360, 72, 58);
}

function colorCachePath(agentDir: string): string {
	return join(agentDir, COLOR_CACHE_FILE);
}

function loadColorCache(agentDir: string): Record<string, string> {
	const path = colorCachePath(agentDir);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
	} catch {
		return {};
	}
}

function saveColorCache(agentDir: string, cache: Record<string, string>): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(colorCachePath(agentDir), JSON.stringify(cache, null, 2), "utf8");
}

export function resolveDisplayColor(
	roleName: string,
	color: unknown,
	options?: { agentDir?: string; diagnostics?: RoleDiagnostic[]; path?: string },
): string {
	const agentDir = options?.agentDir ?? getAgentDir();
	if (typeof color === "string" && color.trim() !== "") {
		const normalized = color.trim();
		if (THEME_TOKENS.has(normalized)) return normalized;
		if (isHexColor(normalized)) return normalized.toLowerCase();
		if (normalized in BUILTIN_COLOR_ALIASES) return BUILTIN_COLOR_ALIASES[normalized]!;
		options?.diagnostics?.push({
			level: "warning",
			message: `invalid color \"${normalized}\"; falling back to generated color`,
			path: options.path,
		});
	}

	const cache = loadColorCache(agentDir);
	const cached = cache[roleName];
	if (cached && isHexColor(cached)) return cached;
	const next = generatedColor(roleName);
	cache[roleName] = next;
	saveColorCache(agentDir, cache);
	return next;
}
