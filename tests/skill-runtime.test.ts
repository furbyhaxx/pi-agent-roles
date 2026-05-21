import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyInheritLoaded, applyRequiredSkills, readActiveSkillBodies, type ActiveSkill } from "../src/skill-runtime.js";

type SkillAction = "required" | "optional" | "hidden";

type TestRole = {
	skills: {
		roots: { inherit: boolean; dirs: string[] };
		inheritLoaded: boolean;
		required: string[];
		hidden: string[];
		rules: Array<{ pattern: string; action: SkillAction }>;
	};
};

type TestSkill = ActiveSkill;

function createRole(overrides: Partial<TestRole["skills"]> = {}): TestRole {
	return {
		skills: {
			roots: { inherit: true, dirs: [] },
			inheritLoaded: true,
			required: [],
			hidden: [],
			rules: [{ pattern: "*", action: "optional" }],
			...overrides,
		},
	};
}

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-skill-runtime-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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

await it("applyRequiredSkills adds only required in-scope visible skills", async () => {
	await withTempDir(async (root) => {
		const visibleRoot = join(root, "visible");
		const hiddenRoot = join(root, "outside");
		await mkdir(visibleRoot, { recursive: true });
		await mkdir(hiddenRoot, { recursive: true });

		const carried: ActiveSkill[] = [
			{ name: "manual-context", filePath: join(root, "manual", "SKILL.md"), contentHash: "manual-hash" },
		];
		const allSkills: TestSkill[] = [
			{ name: "systematic-debugging", filePath: join(visibleRoot, "systematic-debugging", "SKILL.md"), contentHash: "hash-1" },
			{ name: "writing-secret", filePath: join(visibleRoot, "writing-secret", "SKILL.md"), contentHash: "hash-2" },
			{ name: "writing-plans", filePath: join(hiddenRoot, "writing-plans", "SKILL.md"), contentHash: "hash-3" },
			{ name: "unrelated", filePath: join(visibleRoot, "unrelated", "SKILL.md"), contentHash: "hash-4" },
		];
		const role = createRole({
			roots: { inherit: false, dirs: [visibleRoot] },
			required: ["systematic-*", "writing-*"],
			hidden: ["writing-secret"],
			rules: [
				{ pattern: "*", action: "optional" },
				{ pattern: "writing-secret", action: "hidden" },
			],
		});

		const active = applyRequiredSkills(carried, role, allSkills);
		assert.deepEqual(active, [
			{ name: "manual-context", filePath: join(root, "manual", "SKILL.md"), contentHash: "manual-hash" },
			{ name: "systematic-debugging", filePath: join(visibleRoot, "systematic-debugging", "SKILL.md"), contentHash: "hash-1" },
		]);
	});
});

await it("applyInheritLoaded clears only when inheritLoaded is false", () => {
	const previous: ActiveSkill[] = [
		{ name: "systematic-debugging", filePath: "/tmp/systematic-debugging/SKILL.md", contentHash: "hash-1" },
	];

	assert.deepEqual(applyInheritLoaded(previous, createRole({ inheritLoaded: false })), []);
	assert.strictEqual(applyInheritLoaded(previous, createRole({ inheritLoaded: true })), previous);
});

await it("readActiveSkillBodies truncates per skill and across the total budget", async () => {
	await withTempDir(async (root) => {
		const active: ActiveSkill[] = [];
		const contents = [
			{ name: "skill-a", fill: "a", size: 9000 },
			{ name: "skill-b", fill: "b", size: 7000 },
			{ name: "skill-c", fill: "c", size: 7000 },
			{ name: "skill-d", fill: "d", size: 7000 },
			{ name: "skill-e", fill: "e", size: 7000 },
		];

		for (const entry of contents) {
			const filePath = join(root, entry.name, "SKILL.md");
			await mkdir(join(root, entry.name), { recursive: true });
			await writeFile(filePath, entry.fill.repeat(entry.size), "utf8");
			active.push({ name: entry.name, filePath, contentHash: `${entry.name}-hash` });
		}

		const bodies = readActiveSkillBodies(active);
		assert.deepEqual(
			bodies.map((entry) => ({ name: entry.name, filePath: entry.filePath })),
			active.map((entry) => ({ name: entry.name, filePath: entry.filePath })),
		);

		assert.ok(Buffer.byteLength(bodies[0].body, "utf8") <= 8 * 1024);
		assert.ok(bodies[0].body.endsWith("[truncated]"));
		assert.equal(bodies[1].body, "b".repeat(7000));
		assert.equal(bodies[2].body, "c".repeat(7000));
		assert.equal(bodies[3].body, "d".repeat(7000));
		assert.ok(Buffer.byteLength(bodies[4].body, "utf8") < 7000);
		assert.ok(bodies[4].body.endsWith("[truncated]"));

		const totalBytes = bodies.reduce((sum, entry) => sum + Buffer.byteLength(entry.body, "utf8"), 0);
		assert.ok(totalBytes <= 32 * 1024);
	});
});

console.log("skill runtime tests passed");
