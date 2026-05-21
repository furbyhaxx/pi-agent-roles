import type { AskPrimaryToolArg, LoadedAskConfig } from "./config.js";

const MAX_DETAIL_LENGTH = 240;

export function getByPath(obj: unknown, path: string): unknown {
	if (path.trim() === "") return undefined;

	let current = obj;
	for (const segment of path.split(".")) {
		if (segment === "") return undefined;
		if (current === null || current === undefined || typeof current !== "object") return undefined;

		const record = current as Record<string, unknown>;
		if (!(segment in record)) return undefined;
		current = record[segment];
	}

	return current;
}

export function flattenInput(input: unknown): Array<[string, string]> {
	if (input === null || input === undefined || typeof input !== "object") return [];

	const flattened: Array<[string, string]> = [];
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		visitValue(flattened, key, value);
	}
	return flattened;
}

export function formatDetail(
	toolName: string,
	input: unknown,
	askConfig: Pick<LoadedAskConfig, "primaryToolArgs">,
): string {
	const path = askConfig.primaryToolArgs[toolName];
	if (!isEnabledPath(path)) return "";

	const value = getByPath(input, path);
	if (value === undefined) return "";

	const detail = `${toolName} ${formatLeafValue(value)}`;
	return truncate(detail, MAX_DETAIL_LENGTH);
}

function visitValue(output: Array<[string, string]>, path: string, value: unknown): void {
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length > 0) {
			for (const [key, nested] of entries) {
				visitValue(output, `${path}.${key}`, nested);
			}
			return;
		}
	}

	output.push([path, previewValue(value)]);
}

function previewValue(value: unknown): string {
	const serialized = safeJsonStringify(value);
	return serialized ?? String(value);
}

function formatLeafValue(value: unknown): string {
	if (typeof value === "string") return value;
	return previewValue(value);
}

function safeJsonStringify(value: unknown): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 1)}…`;
}

function isEnabledPath(path: AskPrimaryToolArg | undefined): path is string {
	return typeof path === "string" && path.trim() !== "";
}
