import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { flattenInput } from "./ask-detail.js";

const MAX_PREVIEW_LENGTH = 80;
const SKIP_VALUE = "__skip__";

export interface PickerOption {
	label: string;
	value: string;
}

type PrimaryArgScope = "global" | "project" | "session";

const SCOPE_OPTIONS = [
	{ label: "Global (default)", value: "global" },
	{ label: "Project", value: "project" },
	{ label: "Just for this session", value: "session" },
] satisfies readonly PickerOption[];

export function buildPickerOptions(input: unknown): PickerOption[] {
	const flat = flattenInput(input);
	if (flat.length <= 1) return [];

	return [
		...flat.map(([path, preview]) => ({
			label: `${path}  →  ${truncate(preview, MAX_PREVIEW_LENGTH)}`,
			value: path,
		})),
		{ label: "<entire input>", value: "" },
		{ label: "<skip — no detail this turn>", value: SKIP_VALUE },
	];
}

export async function pickPrimaryArg(
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
): Promise<{ path?: string; scope: PrimaryArgScope | "skip" }> {
	const flat = flattenInput(input);
	if (flat.length === 0) return { scope: "skip" };
	if (flat.length === 1) {
		const [path] = flat[0]!;
		const scope = await pickScope(ctx, toolName, path);
		return scope === "skip" ? { scope } : { path, scope };
	}

	const picked = await selectValue(ctx, `Pick the primary argument for "${toolName}"`, buildPickerOptions(input));
	if (picked === undefined || picked === SKIP_VALUE) return { scope: "skip" };

	const scope = await pickScope(ctx, toolName, picked);
	return scope === "skip" ? { scope } : { path: picked, scope };
}

async function pickScope(
	ctx: ExtensionContext,
	_toolName: string,
	_path: string,
): Promise<PrimaryArgScope | "skip"> {
	const picked = await selectValue(ctx, "Save where?", SCOPE_OPTIONS);
	if (picked === "global" || picked === "project" || picked === "session") return picked;
	return "skip";
}

async function selectValue(
	ctx: ExtensionContext,
	title: string,
	options: readonly PickerOption[],
): Promise<string | undefined> {
	const selectedLabel = await ctx.ui.select(title, options.map((option) => option.label));
	if (selectedLabel === undefined) return undefined;
	return options.find((option) => option.label === selectedLabel)?.value;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 1)}…`;
}
