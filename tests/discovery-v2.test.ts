import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRoles } from "../src/discovery.js";
import { writeRole } from "./discovery.test.js";

async function withTempRoots(run: (paths: { root: string; agentDir: string; globalRoot: string; projectRoot: string }) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-discovery-v2-"));
	const agentDir = join(root, "agent");
	const globalRoot = join(agentDir, "roles");
	const projectRoot = join(root, "project", ".pi", "roles");
	try {
		await mkdir(globalRoot, { recursive: true });
		await mkdir(projectRoot, { recursive: true });
		await run({ root, agentDir, globalRoot, projectRoot });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function it(name: string, run: () => Promise<void>): Promise<void> {
	try {
		await run();
		console.log(`ok - ${name}`);
	} catch (error) {
		console.error(`not ok - ${name}`);
		throw error;
	}
}

async function main(): Promise<void> {
	await it("parses skills.roots.inherit=false with dirs and required/optional/hidden globs", async () => {
		await withTempRoots(async ({ agentDir, globalRoot, projectRoot }) => {
			const nestedRoot = join(projectRoot, "nested");
			const rolePath = join(nestedRoot, "scoped-skills.md");
			await writeRole(
				rolePath,
				`---
name: scoped-skills
label: Scoped Skills
description: Scoped skill loading.
activation: both
triggerDescription: Use for scoped skill loading.
tools:
  inherit: true
skills:
  roots:
    inherit: false
    dirs:
      - ../shared-skills
      - ./local-skills
  inherit_loaded: false
  required:
    - systematic-*
    - writing-plans
  optional:
    - requesting-*
  hidden:
    - secret-*
prompt: append
---
Scoped skills instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			const role = discovered.roles.find((entry) => entry.name === "scoped-skills");
			assert.ok(role);
			assert.equal(role.skills.roots.inherit, false);
			assert.deepEqual(role.skills.roots.dirs, [
				join(projectRoot, "shared-skills"),
				join(projectRoot, "nested", "local-skills"),
			]);
			assert.equal(role.skills.inheritLoaded, false);
			assert.deepEqual(role.skills.required, ["systematic-*", "writing-plans"]);
			assert.deepEqual(role.skills.optional, ["requesting-*"]);
			assert.deepEqual(role.skills.hidden, ["secret-*"]);
		});
	});

	await it("parses tools.inherit=false with allow/ask/hidden lists", async () => {
		await withTempRoots(async ({ agentDir, projectRoot }) => {
			await writeRole(
				join(projectRoot, "tool-policy.md"),
				`---
name: tool-policy
label: Tool Policy
description: Tool policy role.
activation: both
triggerDescription: Use for tool policy checks.
tools:
  inherit: false
  allow:
    - read
    - grep
  ask:
    - bash
  hidden:
    - web_*
skills:
  required:
    - systematic-debugging
prompt: append
---
Tool policy instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			const role = discovered.roles.find((entry) => entry.name === "tool-policy");
			assert.ok(role);
			assert.equal(role.tools.inherit, false);
			assert.deepEqual(role.tools.allow, ["read", "grep"]);
			assert.deepEqual(role.tools.ask, ["bash"]);
			assert.deepEqual(role.tools.hidden, ["web_*"]);
			assert.deepEqual(role.tools.rules, [
				{ pattern: "*", action: "deny" },
				{ pattern: "read", action: "allow" },
				{ pattern: "grep", action: "allow" },
				{ pattern: "bash", action: "ask" },
				{ pattern: "web_*", action: "deny" },
			]);
		});
	});

	await it("rejects legacy skills shorthand array", async () => {
		await withTempRoots(async ({ agentDir, projectRoot }) => {
			await writeRole(
				join(projectRoot, "builder.md"),
				`---
name: builder
label: Builder
description: Valid builder role.
activation: both
triggerDescription: Use for general work.
tools:
  inherit: true
prompt: append
---
Builder instructions.
`,
			);
			await writeRole(
				join(projectRoot, "legacy-array.md"),
				`---
name: legacy-array
label: Legacy Array
description: Legacy skills array.
activation: both
triggerDescription: Legacy array role.
skills: [systematic-debugging]
---
Legacy array instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			assert.deepEqual(discovered.roles.map((role) => role.name), ["builder"]);
			assert.ok(discovered.diagnostics.some((entry) => entry.level === "warning" && /migration/i.test(entry.message)));
		});
	});

	await it("rejects legacy skills mapping", async () => {
		await withTempRoots(async ({ agentDir, projectRoot }) => {
			await writeRole(
				join(projectRoot, "builder.md"),
				`---
name: builder
label: Builder
description: Valid builder role.
activation: both
triggerDescription: Use for general work.
tools:
  inherit: true
prompt: append
---
Builder instructions.
`,
			);
			await writeRole(
				join(projectRoot, "legacy-mapping.md"),
				`---
name: legacy-mapping
label: Legacy Mapping
description: Legacy skills mapping.
activation: both
triggerDescription: Legacy mapping role.
skills:
  systematic-debugging: required
---
Legacy mapping instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			assert.deepEqual(discovered.roles.map((role) => role.name), ["builder"]);
			assert.ok(discovered.diagnostics.some((entry) => entry.level === "warning" && /migration/i.test(entry.message)));
		});
	});

	await it("rejects legacy tools mapping", async () => {
		await withTempRoots(async ({ agentDir, projectRoot }) => {
			await writeRole(
				join(projectRoot, "builder.md"),
				`---
name: builder
label: Builder
description: Valid builder role.
activation: both
triggerDescription: Use for general work.
tools:
  inherit: true
prompt: append
---
Builder instructions.
`,
			);
			await writeRole(
				join(projectRoot, "legacy-tools.md"),
				`---
name: legacy-tools
label: Legacy Tools
description: Legacy tools mapping.
activation: both
triggerDescription: Legacy tools role.
tools:
  bash: ask
---
Legacy tools instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			assert.deepEqual(discovered.roles.map((role) => role.name), ["builder"]);
			assert.ok(discovered.diagnostics.some((entry) => entry.level === "warning" && /migration/i.test(entry.message)));
		});
	});

	await it("defaults: missing skills block produces roots.inherit=true, inheritLoaded=true, empty lists", async () => {
		await withTempRoots(async ({ agentDir, projectRoot }) => {
			await writeRole(
				join(projectRoot, "defaults-skills.md"),
				`---
name: defaults-skills
label: Default Skills
description: Missing skills block.
activation: both
triggerDescription: Use for default skills checks.
tools:
  inherit: true
prompt: append
---
Default skills instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			const role = discovered.roles.find((entry) => entry.name === "defaults-skills");
			assert.ok(role);
			assert.equal(role.hasExplicitSkills, false);
			assert.equal(role.skills.roots.inherit, true);
			assert.deepEqual(role.skills.roots.dirs, []);
			assert.equal(role.skills.inheritLoaded, true);
			assert.deepEqual(role.skills.required, []);
			assert.deepEqual(role.skills.optional, []);
			assert.deepEqual(role.skills.hidden, []);
			assert.deepEqual(role.skills.rules, [{ pattern: "*", action: "optional" }]);
		});
	});

	await it("defaults: missing tools block produces inherit=true, no rules", async () => {
		await withTempRoots(async ({ agentDir, projectRoot }) => {
			await writeRole(
				join(projectRoot, "defaults-tools.md"),
				`---
name: defaults-tools
label: Default Tools
description: Missing tools block.
activation: both
triggerDescription: Use for default tools checks.
prompt: append
---
Default tools instructions.
`,
			);

			const discovered = discoverRoles({
				agentDir,
				globalRoots: [],
				projectRoots: [projectRoot],
			});
			const role = discovered.roles.find((entry) => entry.name === "defaults-tools");
			assert.ok(role);
			assert.equal(role.tools.inherit, true);
			assert.deepEqual(role.tools.allow, []);
			assert.deepEqual(role.tools.ask, []);
			assert.deepEqual(role.tools.hidden, []);
			assert.deepEqual(role.tools.rules, [{ pattern: "*", action: "allow" }]);
		});
	});

	console.log("discovery v2 tests passed");
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
