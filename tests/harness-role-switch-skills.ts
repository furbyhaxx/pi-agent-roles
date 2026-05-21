import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reconstructActiveSkills } from "../src/skill-runtime.ts";

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
	mkdirSync(join(cwd, ".pi", "skills", "carry-skill"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "skills", "must-have"), { recursive: true });

	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify(
			{
				roles: {
					default: "builder",
					userSwitchMode: "end_turn",
					showWidgetWhenFancyEditorMissing: true,
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
tools:
  inherit: false
  allow:
    - read
    - grep
    - find
skills:
  inherit_loaded: false
  required:
    - must-have
  hidden:
    - "*"
prompt: replace
---
Reviewer instructions.
`,
	);

	writeFileSync(
		join(cwd, ".pi", "skills", "carry-skill", "SKILL.md"),
		`---
name: carry-skill
description: Carries over unless the next role refuses it.
---

# Carry Skill
`,
	);
	writeFileSync(
		join(cwd, ".pi", "skills", "must-have", "SKILL.md"),
		`---
name: must-have
description: Required for reviewer role.
---

# Must Have
`,
	);
}

async function main(): Promise<void> {
	const { calls, createTestSession, says, when } = await loadHarness();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agent-roles-switch-skills-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(cwd, ".agent");
	writeRoleFixture(cwd);

	const activeSkillsByTurn: string[][] = [];
	const t = await createTestSession({
		cwd,
		extensions: [extensionPath],
		extensionFactories: [
			(pi: any) => {
				pi.on("before_agent_start", (_event: any, ctx: any) => {
					activeSkillsByTurn.push(
						(reconstructActiveSkills(ctx.sessionManager.getBranch()) ?? [])
							.map((skill) => skill.name)
							.sort(),
					);
				});
			},
		],
		mockTools: MOCK_TOOLS,
	});

	try {
		await t.run(
			when("Activate the carry skill", [
				calls("skill", { action: "activate", name: "carry-skill" }),
				says("Activated."),
			]),
			when("Switch to reviewer", [
				calls("role_switch", { role: "reviewer", reason: "Need required reviewer skill only" }),
				says("Switched."),
			]),
			when("Confirm reviewer state", [
				says("Confirmed."),
			]),
		);

		const skillResult = t.events.toolResultsFor("skill")[0];
		assert(skillResult, "skill activation result should exist");
		assert.equal((skillResult.details as any).activated, "carry-skill");
		assert.deepEqual(activeSkillsByTurn[1], ["carry-skill"]);
		assert.deepEqual(activeSkillsByTurn[2], ["must-have"]);

		console.log("harness role-switch-skills tests passed");
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
