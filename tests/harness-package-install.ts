import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultHarnessDir = "/Projects/furbyhaxx/pi-coding-agent/pi-test-harness";

interface HarnessApi {
	verifySandboxInstall: (options: Record<string, unknown>) => Promise<any>;
	when: (prompt: string, actions: any[]) => any;
	says: (text: string) => any;
}

let harnessPromise: Promise<HarnessApi> | undefined;

function importSpecifier(specifier: string): string {
	return pathToFileURL(resolve(specifier)).href;
}

function harnessCandidates(): string[] {
	const harnessPath = process.env.PI_TEST_HARNESS_PATH ?? process.env.PI_TEST_HARNESS_DIR ?? defaultHarnessDir;
	const resolved = resolve(harnessPath);
	return [join(resolved, "src", "index.ts"), join(resolved, "dist", "index.js")];
}

async function loadHarness(): Promise<HarnessApi> {
	if (harnessPromise) return harnessPromise;
	harnessPromise = (async () => {
		let lastError: unknown;
		for (const candidate of harnessCandidates()) {
			try {
				const loaded = await import(importSpecifier(candidate)) as Partial<HarnessApi>;
				if (loaded.verifySandboxInstall && loaded.when && loaded.says) return loaded as HarnessApi;
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

async function main(): Promise<void> {
	const { says, verifySandboxInstall, when } = await loadHarness();
	const result = await verifySandboxInstall({
		packageDir: process.cwd(),
		expect: {
			extensions: 1,
			skills: 0,
			prompts: 0,
			themes: 0,
		},
		smoke: {
			mockTools: {
				bash: "bash ok",
				read: "read ok",
				write: "write ok",
				edit: "edit ok",
				find: "find ok",
				grep: "grep ok",
				ls: "ls ok",
			},
			script: [
				when("Confirm installed package loads", [
					says("Installed package loaded."),
				]),
			],
		},
	});

	assert.deepEqual(result.loaded.extensionErrors, []);
	assert.equal(result.loaded.extensions, 1);
	assert.equal(result.loaded.skills, 0, "bundled role-creator is exposed dynamically by the extension, not statically by the package manifest");
	assert(result.smoke, "sandbox smoke result should be present");
	assert.equal(result.smoke?.events.toolSequence().length, 0);

	console.log("harness package-install tests passed");
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
