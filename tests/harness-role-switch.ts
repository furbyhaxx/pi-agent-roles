import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface CapturedTurn {
	prompt: string;
	systemPrompt: string;
	selectedTools: string[];
	payloads: unknown[];
	roleContextMessages: string[];
}

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
				if (loaded.calls && loaded.createTestSession && loaded.says && loaded.when) {
					return loaded as HarnessApi;
				}
				lastError = new Error(`Harness candidate ${candidate} did not export the expected API`);
			} catch (error) {
				lastError = error;
			}
		}
		throw new Error(
			`Unable to load pi-test-harness. Set PI_TEST_HARNESS_PATH if needed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
		);
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
	mkdirSync(join(cwd, ".pi", "skills", "systematic-debugging"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "skills", "requesting-code-review"), { recursive: true });

	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify(
			{
				roles: {
					default: "builder",
					userSwitchMode: "end_turn",
					showWidgetWhenFancyEditorMissing: true,
					temperatureBlacklist: ["*/*"],
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
tools: all
skills:
  "*": optional
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
temperature: 0.2
tools:
  "*": deny
  read: allow
  grep: allow
  find: allow
skills:
  "*": hidden
  requesting-code-review: required
prompt: replace
---
Reviewer instructions.
`,
	);

	writeFileSync(
		join(cwd, ".pi", "skills", "systematic-debugging", "SKILL.md"),
		`---
name: systematic-debugging
description: Use when debugging unexpected behavior.
---

# Systematic Debugging
`,
	);
	writeFileSync(
		join(cwd, ".pi", "skills", "requesting-code-review", "SKILL.md"),
		`---
name: requesting-code-review
description: Use before merge or completion.
---

# Requesting Code Review
`,
	);
}

async function main(): Promise<void> {
	const { calls, createTestSession, says, when } = await loadHarness();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agent-roles-harness-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(cwd, ".agent");
	writeRoleFixture(cwd);

	const captured: CapturedTurn[] = [];
	const t = await createTestSession({
		cwd,
		extensions: [extensionPath],
		extensionFactories: [
			(pi: any) => {
				pi.on("before_agent_start", (event: any) => {
					captured.push({
						prompt: event.prompt,
						systemPrompt: event.systemPrompt,
						selectedTools: [...(event.systemPromptOptions.selectedTools ?? [])],
						payloads: [],
						roleContextMessages: [],
					});
				});
				pi.on("context", (event: any) => {
					const current = captured.at(-1);
					if (!current) return;
					current.roleContextMessages = event.messages
						.filter((message: any) => message.customType === "pi-agent-roles-state")
						.map((message: any) => String(message.content));
				});
				pi.on("before_provider_request", (event: any) => {
					const current = captured.at(-1);
					if (!current) return;
					current.payloads.push(event.payload);
				});
			},
		],
		mockTools: MOCK_TOOLS,
	});

	try {
		const initialTools = (t.session as any).getActiveToolNames() as string[];
		assert(initialTools.includes("role_switch"), "role_switch should be active in the default builder role");
		assert(!initialTools.includes("role:switch"), "legacy colon tool name must be gone");

		await t.run(
			when("Switch to reviewer", [
				calls("role_switch", { role: "reviewer", reason: "Need review mode" }),
				says("Switched."),
			]),
			when("Describe the active role", [
				says("Checked."),
			]),
		);

		const roleSwitchResult = t.events.toolResultsFor("role_switch")[0];
		assert(roleSwitchResult, "role_switch result should exist");
		assert.equal((roleSwitchResult.details as any).activeRole, "reviewer");
		assert.equal((roleSwitchResult.details as any).previousRole, "builder");
		assert.equal((roleSwitchResult.details as any).activationSource, "agent");

		assert.equal(captured.length, 2);
		assert(captured[0]!.selectedTools.includes("role_switch"));
		assert.match(captured[1]!.systemPrompt, /Current role: `reviewer` \(Reviewer\)/);
		assert(captured[1]!.selectedTools.includes("read"));
		assert(captured[1]!.selectedTools.includes("grep"));
		assert(captured[1]!.selectedTools.includes("find"));
		assert(!captured[1]!.selectedTools.includes("bash"));
		assert(!captured[1]!.selectedTools.includes("role_switch"));
		assert.doesNotMatch(captured[1]!.systemPrompt, /systematic-debugging/);
		assert.match(captured[1]!.systemPrompt, /requesting-code-review/);
		assert.equal(captured[1]!.roleContextMessages.length, 0, "role state should no longer be injected as a separate context message");
		const payloadText = JSON.stringify(captured[1]!.payloads.at(-1));
		assert.match(payloadText, /<role-state>/);
		assert.match(payloadText, /<required>requesting-code-review<\/required>/);
		assert.match(payloadText, /Use `role_switch` only when another listed role is a better fit\./);
		assert.equal((captured[1]!.payloads.at(-1) as any)?.temperature, undefined);

		console.log("harness role-switch tests passed");
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
