import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { createSkillToolHandler } from "../src/skill-tool.js";
import type { ActiveSkill } from "../src/skill-runtime.js";
import type { ResolvedRole, RoleSkillsConfig, RoleToolsConfig } from "../src/types.js";

function mkTools(overrides: Partial<RoleToolsConfig> = {}): RoleToolsConfig {
	return {
		inherit: true,
		allow: [],
		ask: [],
		hidden: [],
		rules: [{ pattern: "*", action: "allow" }],
		...overrides,
	};
}

function mkSkills(inScopeDirs: string[], overrides: Partial<RoleSkillsConfig> = {}): RoleSkillsConfig {
	return {
		roots: { inherit: false, dirs: inScopeDirs },
		inheritLoaded: true,
		required: [],
		optional: [],
		hidden: [],
		rules: [{ pattern: "*", action: "optional" }],
		...overrides,
	};
}

function mkRole(inScopeDirs: string[]): ResolvedRole {
	return {
		name: "builder",
		label: "Builder",
		description: "General coding role.",
		index: 0,
		displayColor: "accent",
		activation: "both",
		sticky: false,
		triggerDescription: "Use for general coding and implementation work.",
		triggerGuidelines: [],
		model: { raw: "inherit", inherit: true },
		thinking: undefined,
		temperature: undefined,
		tools: mkTools(),
		skills: mkSkills(inScopeDirs),
		hasExplicitSkills: true,
		promptMode: "append",
		body: "Builder instructions.",
		filePath: "/tmp/builder.md",
		scope: "project",
		agentSwitchable: true,
	};
}

function withTempDir(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "pi-agent-roles-skill-tool-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeSkill(root: string, name: string, description: string, body: string, extraFrontmatter = ""): Skill {
	const baseDir = join(root, name);
	const filePath = join(baseDir, "SKILL.md");
	mkdirSync(baseDir, { recursive: true });
	writeFileSync(
		filePath,
		`---\nname: ${name}\ndescription: ${description}\ncategory: ${name}\n${extraFrontmatter}---\n${body.trim()}\n`,
		"utf8",
	);
	return {
		name,
		description,
		filePath,
		baseDir,
		sourceInfo: { path: filePath, source: "path", scope: "temporary", origin: "top-level" as const },
		disableModelInvocation: false,
	};
}

async function it(name: string, run: () => Promise<void> | void): Promise<void> {
	try {
		await run();
		console.log(`ok - ${name}`);
	} catch (error) {
		console.error(`not ok - ${name}`);
		throw error;
	}
}

await it("search returns ranked in-scope hits with snippet and score", async () => {
	withTempDir(async (root) => {
		const traceSkill = writeSkill(
			root,
			"trace-debugger",
			"Investigate crash traces and debugging evidence",
			"Use this skill to debug crash traces and inspect runtime debugging output before proposing a fix.",
		);
		const loggingSkill = writeSkill(
			root,
			"logging-basics",
			"Add a single trace log when a failure is hard to reproduce",
			"Logging is useful, but this skill mostly focuses on concise logs.",
		);
		writeSkill(root, "out-of-scope", "Hidden skill", "Contains crash trace debugging too.");
		const skills = [traceSkill, loggingSkill];
		let active: ActiveSkill[] = [];
		const handler = createSkillToolHandler({
			getRole: () => mkRole(skills.map((skill) => skill.baseDir)),
			getActive: () => active,
			setActive: (next) => {
				active = [...next];
			},
			allSkills: () => [traceSkill, loggingSkill, writeSkill(root, "blocked-skill", "Blocked", "Contains crash trace debugging too.")],
			persist: () => undefined,
		});

		const result = await handler({ action: "search", query: "crash trace debugging", limit: 2 });
		if (!("hits" in result)) throw new Error(`Expected search hits, got ${JSON.stringify(result)}`);
		const hits = result.hits as Array<{ name: string; snippet: string; score: number }>;

		assert.equal(hits.length, 2);
		assert.deepEqual(hits.map((hit) => hit.name), ["trace-debugger", "logging-basics"]);
		assert.ok(hits[0]!.score > hits[1]!.score);
		assert.equal(typeof hits[0]!.snippet, "string");
		assert.ok(hits[0]!.snippet.length > 0);
	});
});

await it("activate adds the skill to the active set and returns the activated name", async () => {
	withTempDir(async (root) => {
		const traceSkill = writeSkill(root, "trace-debugger", "Investigate crash traces", "Use this skill for crash debugging.");
		let active: ActiveSkill[] = [];
		let persisted = 0;
		const handler = createSkillToolHandler({
			getRole: () => mkRole([traceSkill.baseDir]),
			getActive: () => active,
			setActive: (next) => {
				active = [...next];
			},
			allSkills: () => [traceSkill],
			persist: () => {
				persisted += 1;
			},
		});

		const result = await handler({ action: "activate", name: "trace-debugger" });

		assert.deepEqual(result, { activated: "trace-debugger" });
		assert.deepEqual(active.map((skill) => skill.name), ["trace-debugger"]);
		assert.equal(persisted, 1);
	});
});

await it("activate rejects out-of-scope skills", async () => {
	withTempDir(async (root) => {
		const traceSkill = writeSkill(root, "trace-debugger", "Investigate crash traces", "Use this skill for crash debugging.");
		const hiddenSkill = writeSkill(root, "hidden-skill", "Hidden skill", "Should stay out of scope.");
		let active: ActiveSkill[] = [];
		let persisted = 0;
		const handler = createSkillToolHandler({
			getRole: () => mkRole([traceSkill.baseDir]),
			getActive: () => active,
			setActive: (next) => {
				active = [...next];
			},
			allSkills: () => [traceSkill, hiddenSkill],
			persist: () => {
				persisted += 1;
			},
		});

		const result = await handler({ action: "activate", name: "hidden-skill" });

		assert.deepEqual(result, { error: "skill not in scope" });
		assert.deepEqual(active, []);
		assert.equal(persisted, 0);
	});
});

await it("deactivate removes active skills and no-ops when the skill is already inactive", async () => {
	withTempDir(async (root) => {
		const traceSkill = writeSkill(root, "trace-debugger", "Investigate crash traces", "Use this skill for crash debugging.");
		let active: ActiveSkill[] = [{ name: traceSkill.name, filePath: traceSkill.filePath, contentHash: "" }];
		let persisted = 0;
		const handler = createSkillToolHandler({
			getRole: () => mkRole([traceSkill.baseDir]),
			getActive: () => active,
			setActive: (next) => {
				active = [...next];
			},
			allSkills: () => [traceSkill],
			persist: () => {
				persisted += 1;
			},
		});

		assert.deepEqual(await handler({ action: "deactivate", name: "trace-debugger" }), { deactivated: "trace-debugger" });
		assert.deepEqual(active, []);
		assert.equal(persisted, 1);

		assert.deepEqual(await handler({ action: "deactivate", name: "trace-debugger" }), { deactivated: "trace-debugger" });
		assert.deepEqual(active, []);
		assert.equal(persisted, 1);
	});
});

await it("info returns frontmatter, file path, and description without activating the skill", async () => {
	withTempDir(async (root) => {
		const traceSkill = writeSkill(
			root,
			"trace-debugger",
			"Investigate crash traces",
			"Use this skill for crash debugging.",
			"owner: qa\n",
		);
		let active: ActiveSkill[] = [];
		const handler = createSkillToolHandler({
			getRole: () => mkRole([traceSkill.baseDir]),
			getActive: () => active,
			setActive: (next) => {
				active = [...next];
			},
			allSkills: () => [traceSkill],
			persist: () => undefined,
		});

		const result = await handler({ action: "info", name: "trace-debugger" });
		if (!("info" in result)) throw new Error(`Expected skill info, got ${JSON.stringify(result)}`);
		const info = result.info as { filePath: string; description: string; frontmatter: Record<string, unknown> };

		assert.equal(info.filePath, traceSkill.filePath);
		assert.equal(info.description, "Investigate crash traces");
		assert.equal(info.frontmatter.name, "trace-debugger");
		assert.equal(info.frontmatter.description, "Investigate crash traces");
		assert.equal(info.frontmatter.owner, "qa");
		assert.deepEqual(active, []);
	});
});

await it("unknown actions return an error", async () => {
	withTempDir(async (root) => {
		const traceSkill = writeSkill(root, "trace-debugger", "Investigate crash traces", "Use this skill for crash debugging.");
		let active: ActiveSkill[] = [];
		const handler = createSkillToolHandler({
			getRole: () => mkRole([traceSkill.baseDir]),
			getActive: () => active,
			setActive: (next) => {
				active = [...next];
			},
			allSkills: () => [traceSkill],
			persist: () => undefined,
		});

		const result = await handler({ action: "wat" } as never);

		assert.deepEqual(result, { error: "unknown action" });
	});
});

console.log("skill tool tests passed");
