import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ROLES_CONFIG, loadRolesConfig } from "../src/config.js";

async function main(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-config-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	try {
		await mkdir(agentDir, { recursive: true });
		await mkdir(join(cwd, ".pi"), { recursive: true });

		assert.deepEqual(DEFAULT_ROLES_CONFIG, {
			defaultRole: undefined,
			roots: [],
			cycleShortcut: "ctrl+r",
			userSwitchMode: "end_turn",
			showWidgetWhenFancyEditorMissing: true,
			temperatureBlacklist: ["openai-codex/*"],
		});

		await writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify(
				{
					roles: {
						default: "reviewer",
						roots: ["~/global-roles", "$PI_CODING_AGENT_DIR/shared-roles"],
						cycleShortcut: "ctrl+shift+r",
						userSwitchMode: "instant",
						showWidgetWhenFancyEditorMissing: false,
						temperatureBlacklist: ["openai-codex/*", "google/*"],
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					roles: {
						default: "builder",
						roots: ["./local-roles"],
						cycleShortcut: "ctrl+x",
						temperatureBlacklist: ["anthropic/*"],
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const loaded = loadRolesConfig(cwd, { agentDir });
			assert.equal(loaded.config.defaultRole, "builder");
			assert.deepEqual(loaded.config.roots, [join(cwd, "local-roles")]);
			assert.equal(loaded.config.cycleShortcut, "ctrl+x");
			assert.equal(loaded.config.userSwitchMode, "instant");
			assert.equal(loaded.config.showWidgetWhenFancyEditorMissing, false);
			assert.deepEqual(loaded.config.temperatureBlacklist, ["anthropic/*"]);
			assert.deepEqual(loaded.defaultRoots, [join(agentDir, "roles"), join(cwd, ".pi", "roles")]);
			assert.deepEqual(loaded.globalRoots, [join(agentDir, "roles"), join(homedir(), "global-roles"), join(agentDir, "shared-roles")]);
			assert.deepEqual(loaded.projectRoots, [join(cwd, ".pi", "roles"), join(cwd, "local-roles")]);
			assert.deepEqual(loaded.sources, [join(agentDir, "settings.json"), join(cwd, ".pi", "settings.json")]);

			await writeFile(
				join(cwd, ".pi", "settings.json"),
				JSON.stringify(
					{
						roles: {
							default: 123,
							roots: "oops",
							cycleShortcut: "",
							userSwitchMode: "later",
							showWidgetWhenFancyEditorMissing: "nope",
							temperatureBlacklist: "oops",
						},
					},
					null,
					2,
				),
				"utf8",
			);

			const coerced = loadRolesConfig(cwd, { agentDir });
			assert.equal(coerced.config.defaultRole, undefined);
			assert.deepEqual(coerced.config.roots, []);
			assert.equal(coerced.config.cycleShortcut, "ctrl+r");
			assert.equal(coerced.config.userSwitchMode, "end_turn");
			assert.equal(coerced.config.showWidgetWhenFancyEditorMissing, true);
			assert.deepEqual(coerced.config.temperatureBlacklist, ["openai-codex/*"]);
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}

		console.log("config tests passed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
