import { createHash } from "node:crypto";

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sortJsonValue(entry));
	}

	if (value && typeof value === "object") {
		return Object.keys(value as Record<string, unknown>)
			.sort()
			.reduce<Record<string, unknown>>((sorted, key) => {
				sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
				return sorted;
			}, {});
	}

	return value;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(sortJsonValue(value)) ?? "undefined";
}

function hashApprovalInput(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function approvalKey(tool: string, input: unknown): string {
	return `${tool}:${hashApprovalInput(input)}`;
}

export type AskStore = {
	isApproved(tool: string, input: unknown): boolean;
	approveTool(tool: string): void;
	approveToolArgs(tool: string, input: unknown): void;
	reset(): void;
};

export function createAskStore(): AskStore {
	const approvedTools = new Set<string>();
	const approvedToolArgs = new Set<string>();

	return {
		isApproved(tool, input) {
			return approvedTools.has(tool) || approvedToolArgs.has(approvalKey(tool, input));
		},
		approveTool(tool) {
			approvedTools.add(tool);
		},
		approveToolArgs(tool, input) {
			approvedToolArgs.add(approvalKey(tool, input));
		},
		reset() {
			approvedTools.clear();
			approvedToolArgs.clear();
		},
	};
}
