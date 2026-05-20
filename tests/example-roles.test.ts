import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const examplePath = join(repoRoot, "examples", "roles", "brainstormer.md");
const localLinkPath = join(repoRoot, ".pi", "roles", "brainstormer.md");

const content = readFileSync(examplePath, "utf8");
assert.match(content, /^---\nname: brainstormer\n/m);
assert.match(content, /label: Brainstormer/);
assert.match(content, /triggerDescription: Use when the user has an idea that needs collaborative exploration, refinement, feasibility checking, and a resulting design before implementation planning\./);
assert.match(content, /brainstorming: required/);
assert.match(content, /writing-plans: optional/);
assert.match(content, /AskUserQuestion: allow/);
assert.match(content, /short proof-of-work/i);

const linkStat = lstatSync(localLinkPath);
assert.equal(linkStat.isSymbolicLink(), true, "repo-local brainstormer role should be symlinked into .pi/roles for live testing");

console.log("example role tests passed");
