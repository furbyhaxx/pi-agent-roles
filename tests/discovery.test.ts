import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverRoles } from "../src/discovery.js";

async function writeRole(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

async function main(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-discovery-"));
	const agentDir = join(root, "agent");
	const globalRoot = join(agentDir, "roles");
	const projectRoot = join(root, "project", ".pi", "roles");
	try {
		await mkdir(globalRoot, { recursive: true });
		await mkdir(projectRoot, { recursive: true });

		await writeRole(
			join(globalRoot, "builder.md"),
			`---
name: builder
label: Builder
index: 10
description: Global builder role.
activation: both
sticky: true
triggerDescription: Use for general implementation work.
color: orange
model: anthropic/claude-sonnet-4-5:high
temperature: 0.2
tools: all
skills:
  "*": optional
prompt: append
---
Global builder instructions.
`,
		);
		await writeRole(
			join(projectRoot, "builder.md"),
			`---
name: builder
label: Project Builder
index: 1
description: Project builder role.
activation: both
sticky: false
triggerDescription: Use for local implementation work.
color: accent
tools:
  "*": ask
  bash: allow
skills: [systematic-debugging, requesting-code-review]
prompt: append
---
Project builder instructions.
`,
		);
		await writeRole(
			join(globalRoot, "nested", "reviewer.md"),
			`---
label: Reviewer
index: 2
description: Review code and plans.
activation: both
sticky: false
triggerDescription: Use for code review and critique.
color: "#2244ff"
tools: [read, grep, find]
skills:
  "*": hidden
  requesting-code-review: required
prompt: replace
---
Reviewer instructions.
`,
		);
		await writeRole(
			join(globalRoot, "nested", "zz-reviewer-copy.md"),
			`---
name: reviewer
label: Duplicate Reviewer
index: 99
description: Duplicate reviewer role.
activation: both
sticky: false
triggerDescription: Duplicate.
---
Should be skipped.
`,
		);
		await writeRole(
			join(globalRoot, "broken.md"),
			`---
name: Broken
label: bad
`,
		);
		await writeRole(
			join(globalRoot, "invalid.md"),
			`---
name: invalid--name
label: Invalid
activation: user
sticky: false
description: Invalid role.
---
Skipped.
`,
		);
		await writeRole(
			join(globalRoot, "agent-only.md"),
			`---
name: agent-only
label: Agent Only
index: 3
description: Agent-only helper.
activation: agent
sticky: true
color: made-up-color
prompt: append
---
Agent-only helper instructions.
`,
		);

		const discovered = discoverRoles({
			agentDir,
			globalRoots: [globalRoot],
			projectRoots: [projectRoot],
		});

		assert.deepEqual(
			discovered.roles.map((role) => role.name),
			["builder", "reviewer", "agent-only"],
		);
		assert.equal(discovered.roles[0]?.label, "Project Builder");
		assert.equal(discovered.roles[0]?.scope, "project");
		assert.equal(discovered.roles[0]?.displayColor, "accent");
		assert.equal(discovered.roles[0]?.tools.at(0)?.action, "ask");
		assert.equal(discovered.roles[0]?.tools.at(1)?.pattern, "bash");
		assert.equal(discovered.roles[0]?.skills.at(0)?.action, "hidden");
		assert.equal(discovered.roles[0]?.skills.at(1)?.pattern, "systematic-debugging");
		assert.equal(discovered.roles[0]?.agentSwitchable, true);
		assert.equal(discovered.roles[1]?.name, "reviewer");
		assert.equal(discovered.roles[1]?.promptMode, "replace");
		assert.equal(discovered.roles[1]?.displayColor, "#2244ff");
		assert.match(discovered.roles[2]?.displayColor ?? "", /^#[0-9a-f]{6}$/i);
		assert.equal(discovered.roles[2]?.sticky, false, "sticky true on agent-only roles should be ignored");
		assert.equal(discovered.roles[2]?.agentSwitchable, false, "missing triggerDescription must keep the role user-hidden from the agent");
		assert.ok(discovered.diagnostics.some((entry) => entry.message.includes('collision')));
		assert.ok(discovered.diagnostics.some((entry) => entry.message.includes('invalid role name')));
		assert.ok(discovered.diagnostics.some((entry) => entry.message.includes('failed to parse')) || discovered.diagnostics.some((entry) => entry.message.includes('YAML')));
		assert.ok(discovered.diagnostics.some((entry) => entry.message.includes('sticky')));
		assert.ok(discovered.diagnostics.some((entry) => entry.message.includes('triggerDescription')));

		const fallback = discoverRoles({
			agentDir,
			globalRoots: [join(root, "empty-global")],
			projectRoots: [join(root, "empty-project")],
		});
		assert.equal(fallback.roles.length, 1);
		assert.equal(fallback.roles[0]?.name, "builder");
		assert.equal(fallback.roles[0]?.scope, "builtin");
		assert.equal(fallback.roles[0]?.displayColor, fallback.roles[0]?.displayColor);

		console.log("discovery tests passed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
