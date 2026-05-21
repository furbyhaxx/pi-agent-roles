import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "typebox";

interface HarnessApi {
	calls: (toolName: string, params?: Record<string, unknown> | (() => Record<string, unknown>)) => any;
	createTestSession: (options: Record<string, unknown>) => Promise<any>;
	says: (text: string) => any;
	when: (prompt: string, actions: any[]) => any;
}

interface AskScenario {
	name: string;
	primaryToolArgs?: Record<string, string | false>;
	select: (title: string, options: string[]) => string | undefined;
	turns: Array<{ prompt: string; input: Record<string, unknown>; reply: string }>;
	assertions: (session: any, cwd: string) => void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const extensionPath = join(packageRoot, "src", "index.ts");
const defaultHarnessDir = "/Projects/furbyhaxx/pi-coding-agent/pi-test-harness";

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

function deploymentInput(path: string, env = "prod"): Record<string, unknown> {
	return {
		target: {
			path,
			env,
		},
	};
}

function pickOption(options: string[], needle: string): string {
	const option = options.find((entry) => entry.includes(needle));
	assert(option, `Expected an option containing ${JSON.stringify(needle)}. Got: ${options.join(" | ")}`);
	return option;
}

function queueSelect(steps: Array<{ title: string | RegExp; option: string }>): (title: string, options: string[]) => string | undefined {
	let index = 0;
	return (title, options) => {
		const step = steps[index++];
		assert(step, `Unexpected select dialog: ${title}`);
		if (typeof step.title === "string") assert.equal(title, step.title);
		else assert.match(title, step.title);
		return pickOption(options, step.option);
	};
}

function writeFixture(cwd: string, primaryToolArgs?: Record<string, string | false>): void {
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	const settings: Record<string, unknown> = {
		roles: {
			default: "builder",
		},
	};
	if (primaryToolArgs) {
		(settings.roles as Record<string, unknown>).ask = {
			primaryToolArgs,
		};
	}

	writeFileSync(join(cwd, ".pi", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
	writeFileSync(
		join(cwd, ".pi", "roles", "builder.md"),
		`---
name: builder
label: Builder
description: Ask flow test role.
index: 0
color: orange
activation: both
sticky: false
tools:
  inherit: false
  ask:
    - deploy
skills:
  optional:
    - "*"
prompt: append
---
Builder instructions.
`,
	);
}

async function runScenario(scenario: AskScenario): Promise<void> {
	const { calls, createTestSession, says, when } = await loadHarness();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agent-roles-ask-flow-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(cwd, ".agent");
	writeFixture(cwd, scenario.primaryToolArgs);

	const session = await createTestSession({
		cwd,
		propagateErrors: false,
		extensions: [extensionPath],
		extensionFactories: [
			(pi: any) => {
				pi.registerTool({
					name: "deploy",
					label: "Deploy",
					description: "Test deploy tool.",
					parameters: Type.Object({
						target: Type.Object({
							path: Type.String(),
							env: Type.Optional(Type.String()),
						}),
					}),
					async execute(_toolCallId: string, params: Record<string, unknown>) {
						const target = params.target as { path?: string } | undefined;
						return { content: [{ type: "text", text: `deploy:${target?.path ?? "<missing>"}` }] };
					},
				});
			},
		],
		mockUI: { select: scenario.select },
	});

	try {
		await session.run(
			...scenario.turns.map((turn) => when(turn.prompt, [
				calls("deploy", turn.input),
				says(turn.reply),
			])),
		);
		scenario.assertions(session, cwd);
	} finally {
		session.dispose();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(cwd, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	await runScenario({
		name: "picker remembers session-scoped primary arg",
		select: queueSelect([
			{ title: 'Pick the primary argument for "deploy"', option: "target.path" },
			{ title: "Save where?", option: "Just for this session" },
			{ title: "Allow deploy?", option: "Allow once" },
			{ title: "Allow deploy?", option: "Allow once" },
		]),
		turns: [
			{ prompt: "Deploy app", input: deploymentInput("/srv/app"), reply: "Deployed app." },
			{ prompt: "Deploy docs", input: deploymentInput("/srv/docs"), reply: "Deployed docs." },
		],
		assertions: (session) => {
			const selectCalls = session.events.uiCallsFor("select");
			assert.equal(selectCalls.length, 4);
			assert.deepEqual(
				selectCalls.map((call: { args: unknown[] }) => String(call.args[0])),
				['Pick the primary argument for "deploy"', "Save where?", "Allow deploy?", "Allow deploy?"],
			);
			assert.match(((selectCalls[2]!.args[1] as string[])[0] ?? ""), /deploy \/srv\/app/);
			assert.match(((selectCalls[3]!.args[1] as string[])[0] ?? ""), /deploy \/srv\/docs/);
			assert.deepEqual(
				session.events.toolResultsFor("deploy").map((result: { text: string }) => result.text),
				["deploy:/srv/app", "deploy:/srv/docs"],
			);
		},
	});

	await runScenario({
		name: "allow once prompts every time",
		primaryToolArgs: { deploy: "target.path" },
		select: queueSelect([
			{ title: "Allow deploy?", option: "Allow once" },
			{ title: "Allow deploy?", option: "Allow once" },
		]),
		turns: [
			{ prompt: "Deploy once A", input: deploymentInput("/srv/once-a"), reply: "Done." },
			{ prompt: "Deploy once B", input: deploymentInput("/srv/once-b"), reply: "Done again." },
		],
		assertions: (session) => {
			const selectCalls = session.events.uiCallsFor("select");
			assert.equal(selectCalls.length, 2);
			assert.match(((selectCalls[0]!.args[1] as string[])[0] ?? ""), /deploy \/srv\/once-a/);
			assert.match(((selectCalls[1]!.args[1] as string[])[0] ?? ""), /deploy \/srv\/once-b/);
			assert.equal(session.events.toolResultsFor("deploy").length, 2);
		},
	});

	await runScenario({
		name: "always tool remembers by tool name",
		primaryToolArgs: { deploy: "target.path" },
		select: queueSelect([
			{ title: "Allow deploy?", option: "Always allow deploy this session" },
		]),
		turns: [
			{ prompt: "Deploy tool A", input: deploymentInput("/srv/tool-a"), reply: "Done." },
			{ prompt: "Deploy tool B", input: deploymentInput("/srv/tool-b", "stage"), reply: "Done again." },
		],
		assertions: (session) => {
			assert.equal(session.events.uiCallsFor("select").length, 1);
			assert.deepEqual(
				session.events.toolResultsFor("deploy").map((result: { text: string }) => result.text),
				["deploy:/srv/tool-a", "deploy:/srv/tool-b"],
			);
		},
	});

	await runScenario({
		name: "always args remembers only exact input",
		primaryToolArgs: { deploy: "target.path" },
		select: queueSelect([
			{ title: "Allow deploy?", option: "Always allow deploy with these args this session" },
			{ title: "Allow deploy?", option: "Always allow deploy with these args this session" },
		]),
		turns: [
			{ prompt: "Deploy args A", input: deploymentInput("/srv/args-a"), reply: "Done." },
			{ prompt: "Deploy args A again", input: deploymentInput("/srv/args-a"), reply: "Done again." },
			{ prompt: "Deploy args B", input: deploymentInput("/srv/args-b"), reply: "Done third." },
		],
		assertions: (session) => {
			assert.equal(session.events.uiCallsFor("select").length, 2);
			assert.deepEqual(
				session.events.toolResultsFor("deploy").map((result: { text: string }) => result.text),
				["deploy:/srv/args-a", "deploy:/srv/args-a", "deploy:/srv/args-b"],
			);
		},
	});

	await runScenario({
		name: "deny blocks execution",
		primaryToolArgs: { deploy: "target.path" },
		select: queueSelect([
			{ title: "Allow deploy?", option: "Deny" },
		]),
		turns: [
			{ prompt: "Deny deploy", input: deploymentInput("/srv/deny"), reply: "Denied." },
		],
		assertions: (session) => {
			const result = session.events.toolResultsFor("deploy")[0];
			assert(result, "expected a blocked deploy result");
			assert.equal(result.isError, true);
			assert.doesNotMatch(result.text, /^deploy:/);
			assert.match(result.text, /denied by the user|blocked/i);
			assert.equal(session.events.uiCallsFor("select").length, 1);
		},
	});

	console.log("harness ask-flow tests passed");
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
