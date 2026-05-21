import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invalidateSystemPromptTemplateCache, loadSystemPromptTemplate } from "../src/template-loader.js";

const bundledTemplatePath = fileURLToPath(new URL("../templates/system-prompt-template.md", import.meta.url));

async function main(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-agent-roles-template-loader-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const projectTemplatePath = join(cwd, ".pi", "roles", "system-prompt-template.md");
	const globalTemplatePath = join(agentDir, "roles", "system-prompt-template.md");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

	try {
		await mkdir(dirname(projectTemplatePath), { recursive: true });
		await mkdir(dirname(globalTemplatePath), { recursive: true });

		const projectTemplate = "  Project {{role.name}}\n";
		const globalTemplate = "Global {{role.label}}\n";
		await writeFile(projectTemplatePath, projectTemplate, "utf8");
		await writeFile(globalTemplatePath, globalTemplate, "utf8");

		process.env.PI_CODING_AGENT_DIR = agentDir;
		invalidateSystemPromptTemplateCache();
		assert.equal(loadSystemPromptTemplate(cwd), projectTemplate);

		await rm(join(cwd, ".pi"), { recursive: true, force: true });
		invalidateSystemPromptTemplateCache();
		assert.equal(loadSystemPromptTemplate(cwd), globalTemplate);

		await rm(join(agentDir, "roles"), { recursive: true, force: true });
		invalidateSystemPromptTemplateCache();
		assert.equal(loadSystemPromptTemplate(cwd), await readFile(bundledTemplatePath, "utf8"));

		await mkdir(dirname(projectTemplatePath), { recursive: true });
		const cachedTemplate = "Cached {{builtinSystemPrompt}}\n";
		await writeFile(projectTemplatePath, cachedTemplate, "utf8");
		invalidateSystemPromptTemplateCache();
		assert.equal(loadSystemPromptTemplate(cwd, agentDir), cachedTemplate);

		const updatedTemplate = "Updated {{builtinSystemPrompt}}\n";
		await writeFile(projectTemplatePath, updatedTemplate, "utf8");
		assert.equal(loadSystemPromptTemplate(cwd, agentDir), cachedTemplate);

		invalidateSystemPromptTemplateCache();
		assert.equal(loadSystemPromptTemplate(cwd, agentDir), updatedTemplate);

		console.log("template-loader tests passed");
	} finally {
		invalidateSystemPromptTemplateCache();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(root, { recursive: true, force: true });
	}
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
