import assert from "node:assert/strict";
import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverRoles } from "../src/discovery.js";
import type { ResolvedRole } from "../src/types.js";

function requireRole(roles: readonly ResolvedRole[], name: string): ResolvedRole {
	const role = roles.find((entry) => entry.name === name);
	assert.ok(role, `expected role ${name} to exist`);
	return role;
}

const repoRoot = resolve(import.meta.dirname, "..");
const examplesRoot = join(repoRoot, "examples", "roles");
const localLinkPath = join(repoRoot, ".pi", "roles", "brainstormer.md");

const discovered = discoverRoles({
	agentDir: repoRoot,
	globalRoots: [examplesRoot],
	projectRoots: [],
});

assert.deepEqual(discovered.diagnostics, [], "bundled example roles should parse without diagnostics");
assert.equal(
	discovered.roles.length,
	readdirSync(examplesRoot).filter((entry) => entry.endsWith(".md")).length,
	"every bundled example role should parse",
);

const brainstormer = requireRole(discovered.roles, "brainstormer");
assert.equal(brainstormer.label, "Brainstormer");
assert.equal(brainstormer.promptMode, "replace");
assert.equal(brainstormer.tools.inherit, false);
assert.deepEqual(brainstormer.tools.allow, ["role_switch", "AskUserQuestion", "read", "grep", "find", "ls", "web_*"]);
assert.deepEqual(brainstormer.tools.ask, ["bash", "write", "edit"]);
assert.deepEqual(brainstormer.tools.hidden, []);
assert.equal(brainstormer.skills.roots.inherit, true);
assert.deepEqual(brainstormer.skills.roots.dirs, []);
assert.equal(brainstormer.skills.inheritLoaded, true);
assert.deepEqual(brainstormer.skills.required, ["brainstorming", "llm-prompt-engineering"]);
assert.deepEqual(brainstormer.skills.optional, ["writing-plans", "extending-pi-agent", "verification-before-completion"]);
assert.deepEqual(brainstormer.skills.hidden, ["*"]);
assert.match(brainstormer.body, /short proof-of-work/i);

const developer = requireRole(discovered.roles, "developer");
assert.equal(developer.promptMode, "append");
assert.equal(developer.tools.inherit, true);
assert.deepEqual(developer.tools.allow, ["*"]);
assert.deepEqual(developer.tools.ask, ["web_*"]);
assert.deepEqual(developer.tools.hidden, []);
assert.equal(developer.skills.inheritLoaded, true);
assert.deepEqual(developer.skills.required, ["test-driven-development", "verification-before-completion"]);
assert.deepEqual(developer.skills.optional, ["systematic-debugging"]);
assert.deepEqual(developer.skills.hidden, ["*"]);

const releaseManager = requireRole(discovered.roles, "release-manager");
assert.equal(releaseManager.displayColor, "#f59e0b");

const linkStat = lstatSync(localLinkPath);
assert.equal(linkStat.isSymbolicLink(), true, "repo-local brainstormer role should be symlinked into .pi/roles for live testing");

console.log("example role tests passed");
