import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillSearchIndex } from "../src/skill-search.js";

type TestSkill = {
	name: string;
	description: string;
	filePath: string;
};

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-skill-search-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeSkill(root: string, name: string, description: string, body: string): Promise<TestSkill> {
	const dir = join(root, name);
	const filePath = join(dir, "SKILL.md");
	await mkdir(dir, { recursive: true });
	await writeFile(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n${body.trim()}\n`, "utf8");
	return { name, description, filePath };
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

await it("builds a BM25-lite index from skill name, description, and body and returns ranked top hits", async () => {
	await withTempDir(async (root) => {
		const traceSkill = await writeSkill(
			root,
			"trace-debugger",
			"Investigate crash traces and debugging evidence",
			`Use this skill to debug crash traces and inspect runtime debugging output before proposing a fix.`,
		);
		const loggingSkill = await writeSkill(
			root,
			"logging-basics",
			"Add a single trace log when a failure is hard to reproduce",
			`Logging is useful, but this skill mostly focuses on concise logs.`,
		);
		const deploySkill = await writeSkill(
			root,
			"deploy-helper",
			"Deployment checklist",
			`Ship builds carefully and verify the rollout.`,
		);

		const index = createSkillSearchIndex([loggingSkill, deploySkill, traceSkill]);
		const hits = index.search("crash trace debugging", { limit: 2 });

		assert.equal(index.size, 3);
		assert.equal(hits.length, 2);
		assert.deepEqual(hits.map((hit) => hit.name), ["trace-debugger", "logging-basics"]);
		assert.ok(hits[0].score > hits[1].score);
	});
});

await it("indexes referenced relative files mentioned with read commands", async () => {
	await withTempDir(async (root) => {
		const skill = await writeSkill(
			root,
			"reference-reader",
			"Loads helper notes",
			`Before editing, read ./scripts/helper.md and follow the helper guidance.`,
		);
		const helperDir = join(root, "reference-reader", "scripts");
		await mkdir(helperDir, { recursive: true });
		await writeFile(
			join(helperDir, "helper.md"),
			"The helper covers zebra cache invalidation and api drift handling.",
			"utf8",
		);

		const index = createSkillSearchIndex([skill]);
		const hits = index.search("zebra invalidation");

		assert.equal(hits.length, 1);
		assert.equal(hits[0].name, "reference-reader");
		assert.match(hits[0].snippet, /zebra cache invalidation/i);
	});
});

await it("returns an approximately 200 character snippet around the best match", async () => {
	await withTempDir(async (root) => {
		const needle = "latencyspike";
		const skill = await writeSkill(
			root,
			"snippet-skill",
			"Snippet extraction test",
			`${"alpha ".repeat(40)}${needle} ${"omega ".repeat(40)}`,
		);

		const index = createSkillSearchIndex([skill]);
		const [hit] = index.search(needle);

		assert.ok(hit);
		assert.match(hit.snippet.toLowerCase(), new RegExp(needle));
		assert.ok(hit.snippet.length >= 150, `snippet too short: ${hit.snippet.length}`);
		assert.ok(hit.snippet.length <= 220, `snippet too long: ${hit.snippet.length}`);
	});
});

await it("excludes out-of-scope skills when a filter is applied", async () => {
	await withTempDir(async (root) => {
		const inScope = await writeSkill(root, "in-scope", "General auth help", `Handle auth tokens and retry flows.`);
		const outOfScope = await writeSkill(root, "out-of-scope", "Hidden skill", `Contains the unique term outscopeonlytoken.`);

		const index = createSkillSearchIndex([inScope, outOfScope], {
			filter: (skill) => skill.name !== "out-of-scope",
		});
		const hits = index.search("outscopeonlytoken");

		assert.equal(index.size, 1);
		assert.deepEqual(hits, []);
	});
});

console.log("skill search tests passed");
