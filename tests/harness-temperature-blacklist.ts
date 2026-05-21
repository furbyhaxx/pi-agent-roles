import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const extensionPath = join(packageRoot, "src", "index.ts");
const defaultHarnessDir = "/Projects/furbyhaxx/pi-coding-agent/pi-test-harness";

interface HarnessApi {
	calls: (toolName: string, params?: Record<string, unknown> | (() => Record<string, unknown>)) => any;
	createTestSession: (options: Record<string, unknown>) => Promise<any>;
	says: (text: string) => any;
	when: (prompt: string, actions: any[]) => any;
}

interface CapturedPayload {
	provider?: string;
	modelId?: string;
	payload: unknown;
}

let harnessPromise: Promise<HarnessApi> | undefined;

function isPathLike(specifier: string): boolean {
	return specifier.startsWith("/") || specifier.startsWith(".") || specifier.startsWith("file:");
}

function importSpecifier(specifier: string): string {
	if (specifier.startsWith("file:")) return specifier;
	return isPathLike(specifier) ? pathToFileURL(resolve(specifier)).href : specifier;
}

function harnessCandidates(): string[] {
	const candidates: string[] = [];
	const moduleSpecifier = process.env.PI_TEST_HARNESS_MODULE;
	const harnessPath = process.env.PI_TEST_HARNESS_PATH ?? process.env.PI_TEST_HARNESS_DIR;
	if (moduleSpecifier) candidates.push(moduleSpecifier);
	if (harnessPath) {
		const resolved = resolve(harnessPath);
		candidates.push(join(resolved, "src", "index.ts"), join(resolved, "dist", "index.js"));
	}
	candidates.push(join(defaultHarnessDir, "src", "index.ts"), join(defaultHarnessDir, "dist", "index.js"));
	return [...new Set(candidates)];
}

async function loadHarness(): Promise<HarnessApi> {
	if (harnessPromise) return harnessPromise;
	harnessPromise = (async () => {
		let lastError: unknown;
		for (const candidate of harnessCandidates()) {
			try {
				const loaded = await import(importSpecifier(candidate)) as Partial<HarnessApi>;
				if (loaded.calls && loaded.createTestSession && loaded.says && loaded.when) return loaded as HarnessApi;
				lastError = new Error(`Harness candidate ${candidate} did not export the expected API`);
			} catch (error) {
				lastError = error;
			}
		}
		throw new Error(`Unable to load pi-test-harness. Set PI_TEST_HARNESS_PATH if needed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	})();
	return harnessPromise;
}

const MOCK_TOOLS = {
	bash: (params: Record<string, unknown>) => `bash:${String(params.command)}`,
	read: (params: Record<string, unknown>) => `read:${String(params.path)}`,
	write: "write ok",
	edit: "edit ok",
	find: "find ok",
	grep: "grep ok",
	ls: "ls ok",
};

function writeRoleFixture(cwd: string): void {
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify(
			{
				roles: {
					default: "builder",
					temperatureBlacklist: ["openai-codex/*"],
				},
			},
			null,
			2,
		),
	);

	writeFileSync(
		join(cwd, ".pi", "roles", "builder.md"),
		`---
name: builder
label: Builder
description: General coding role.
index: 0
color: orange
activation: both
sticky: false
triggerDescription: Use for general coding and implementation work.
model: anthropic/claude-sonnet-4-5:high
tools:
  inherit: true
skills:
  optional:
    - "*"
prompt: append
---
Builder instructions.
`,
	);

	writeFileSync(
		join(cwd, ".pi", "roles", "reviewer.md"),
		`---
name: reviewer
label: Reviewer
description: Review code and plans.
index: 1
color: accent
activation: both
sticky: false
triggerDescription: Use for review and critique tasks.
model: openai-codex/gpt-5.5:high
temperature: 0.2
tools:
  inherit: false
  allow:
    - read
    - grep
    - find
skills:
  hidden:
    - "*"
prompt: replace
---
Reviewer instructions.
`,
	);
}

async function main(): Promise<void> {
	const { calls, createTestSession, says, when } = await loadHarness();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agent-roles-temp-blacklist-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(cwd, ".agent");
	writeRoleFixture(cwd);

	const captured: CapturedPayload[] = [];
	const t = await createTestSession({
		cwd,
		extensions: [extensionPath],
		extensionFactories: [
			(pi: any) => {
				pi.on("before_provider_request", (event: any, ctx: any) => {
					captured.push({
						provider: ctx.model?.provider,
						modelId: ctx.model?.id,
						payload: event.payload,
					});
				});
			},
		],
		mockTools: MOCK_TOOLS,
	});

	try {
		await t.run(
			when("Switch to reviewer", [
				calls("role_switch", { role: "reviewer", reason: "Check temperature blacklist" }),
				says("Switched."),
			]),
		);

		assert(captured.length >= 2, "expected at least two provider requests in the same user prompt");
		const first = captured[0]!;
		const last = captured.at(-1)!;
		assert.equal(first.provider, "anthropic");
		assert.equal(last.provider, "openai-codex", "the follow-up request after role_switch should use the switched model");
		assert.equal((last.payload as any)?.temperature, undefined, "blacklisted models must not receive top-level temperature");
		assert.equal((last.payload as any)?.generationConfig?.temperature, undefined, "blacklisted models must not receive nested generationConfig.temperature");

		console.log("harness temperature blacklist tests passed");
	} finally {
		t.dispose();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(cwd, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
