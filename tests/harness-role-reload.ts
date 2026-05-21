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

function writeBuilderOnlyFixture(cwd: string): void {
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ roles: { default: "builder", userSwitchMode: "end_turn" } }, null, 2),
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
}

function writeReviewerRole(cwd: string): void {
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
	const cwd = mkdtempSync(join(tmpdir(), "pi-agent-roles-reload-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(cwd, ".agent");
	writeBuilderOnlyFixture(cwd);

	let capturedCommands: string[] = [];
	let beforeAgentStartCount = 0;
	const t = await createTestSession({
		cwd,
		extensions: [extensionPath],
		extensionFactories: [
			(pi: any) => {
				pi.on("session_start", () => {
					capturedCommands = pi.getCommands().map((command: { name: string }) => command.name);
				});
				pi.on("before_agent_start", () => {
					beforeAgentStartCount += 1;
				});
			},
		],
		mockTools: MOCK_TOOLS,
	});

	try {
		assert(capturedCommands.includes("role:reload"), "role:reload command should be registered");

		const initialTools = (t.session as any).getActiveToolNames() as string[];
		assert(!initialTools.includes("role_switch"), "role_switch should stay hidden until an alternative role exists");

		writeReviewerRole(cwd);
		await (t.session as any).prompt("/role:reload");
		await (t.session.agent as any).waitForIdle();

		const reloadedTools = (t.session as any).getActiveToolNames() as string[];
		assert(reloadedTools.includes("role_switch"), "role_switch should become visible after /role:reload discovers the new role");

		await t.run(
			when("Switch to reviewer after command reload", [
				calls("role_switch", { role: "reviewer", reason: "reload worked" }),
				says("Switched."),
			]),
		);

		const result = t.events.toolResultsFor("role_switch").at(-1);
		assert(result, "role_switch should run after role reload");
		assert.equal((result.details as any).activeRole, "reviewer");

		console.log("harness role-reload tests passed");
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
