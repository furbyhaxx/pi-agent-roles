import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadAskConfig,
	saveAskPrimaryToolArg,
	SettingsJsonParseError,
} from "../src/config.js";

async function main(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-config-ask-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	const globalSettingsPath = join(agentDir, "settings.json");
	const projectSettingsPath = join(cwd, ".pi", "settings.json");

	try {
		await mkdir(agentDir, { recursive: true });
		await mkdir(join(cwd, ".pi"), { recursive: true });

		await writeFile(
			globalSettingsPath,
			JSON.stringify(
				{
					provider: { default: "claude" },
					roles: {
						default: "reviewer",
						ask: {
							primaryToolArgs: {
								bash: "global.command",
								grep: "query",
								custom_tool: "payload.target",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			projectSettingsPath,
			JSON.stringify(
				{
					roles: {
						ask: {
							primaryToolArgs: {
								bash: "project.command",
								custom_tool: false,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const loaded = loadAskConfig(cwd, { agentDir });
		assert.equal(loaded.primaryToolArgs.bash, "project.command");
		assert.equal(loaded.primaryToolArgs.grep, "query");
		assert.equal(loaded.primaryToolArgs.custom_tool, false);
		assert.deepEqual(
			Object.keys(loaded.primaryToolArgs).filter((key) => [
				"bash",
				"write",
				"edit",
				"read",
				"grep",
				"find",
				"ls",
				"web_fetch",
				"shell_exec",
				"shell_write_stdin",
				"shell_kill_session",
			].includes(key)),
			[
				"bash",
				"write",
				"edit",
				"read",
				"grep",
				"find",
				"ls",
				"web_fetch",
				"shell_exec",
				"shell_write_stdin",
				"shell_kill_session",
			],
		);

		await writeFile(
			globalSettingsPath,
			JSON.stringify(
				{
					provider: { default: "claude" },
					roles: {
						default: "reviewer",
						ask: {
							primaryToolArgs: {
								read: "path",
							},
							remember: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		saveAskPrimaryToolArg("bash", "command", { scope: "global", agentDir });
		const savedGlobalRaw = await readFile(globalSettingsPath, "utf8");
		const savedGlobal = JSON.parse(savedGlobalRaw);
		assert.equal(savedGlobal.provider.default, "claude");
		assert.equal(savedGlobal.roles.default, "reviewer");
		assert.equal(savedGlobal.roles.ask.remember, true);
		assert.equal(savedGlobal.roles.ask.primaryToolArgs.read, "path");
		assert.equal(savedGlobal.roles.ask.primaryToolArgs.bash, "command");
		assert.match(savedGlobalRaw, /^\{\n  /);

		await writeFile(
			projectSettingsPath,
			JSON.stringify(
				{
					model: "gpt",
					roles: {
						ask: {
							primaryToolArgs: {
								write: "path",
							},
							enabled: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		saveAskPrimaryToolArg("bash", "command", { scope: "project", cwd });
		const savedProjectRaw = await readFile(projectSettingsPath, "utf8");
		const savedProject = JSON.parse(savedProjectRaw);
		assert.equal(savedProject.model, "gpt");
		assert.equal(savedProject.roles.ask.enabled, true);
		assert.equal(savedProject.roles.ask.primaryToolArgs.write, "path");
		assert.equal(savedProject.roles.ask.primaryToolArgs.bash, "command");
		assert.match(savedProjectRaw, /^\{\n  /);

		const invalidJson = "{\n  \"roles\": {\n";
		await writeFile(globalSettingsPath, invalidJson, "utf8");
		assert.throws(
			() => saveAskPrimaryToolArg("bash", "command", { scope: "global", agentDir }),
			(error: unknown) => {
				assert.ok(error instanceof SettingsJsonParseError);
				assert.equal(error.path, globalSettingsPath);
				return true;
			},
		);
		assert.equal(await readFile(globalSettingsPath, "utf8"), invalidJson);
		assert.equal(existsSync(`${globalSettingsPath}.tmp`), false);

		console.log("config ask tests passed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
