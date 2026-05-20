import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

function isHexColor(value: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string) {
	return {
		r: Number.parseInt(hex.slice(1, 3), 16),
		g: Number.parseInt(hex.slice(3, 5), 16),
		b: Number.parseInt(hex.slice(5, 7), 16),
	};
}

function rgbTo256(color: { r: number; g: number; b: number }): number {
	const toCube = (value: number) => Math.round((value / 255) * 5);
	return 16 + 36 * toCube(color.r) + 6 * toCube(color.g) + toCube(color.b);
}

export function paintColor(theme: Theme, color: string, text: string): string {
	if (text.length === 0) return "";
	if (isHexColor(color)) {
		const { r, g, b } = hexToRgb(color);
		const colorMode = typeof (theme as unknown as { getColorMode?: () => "truecolor" | "256color" }).getColorMode === "function"
			? (theme as unknown as { getColorMode: () => "truecolor" | "256color" }).getColorMode()
			: "truecolor";
		const ansi = colorMode === "256color"
			? `\x1b[38;5;${rgbTo256({ r, g, b })}m`
			: `\x1b[38;2;${r};${g};${b}m`;
		return `${ansi}${text}\x1b[39m`;
	}
	try {
		return theme.fg(color as ThemeColor, text);
	} catch {
		return text;
	}
}
