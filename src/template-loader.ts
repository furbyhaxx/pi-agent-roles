import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_FILE = "system-prompt-template.md";
const bundledTemplatePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates", TEMPLATE_FILE);
const templateCache = new Map<string, string>();

function resolveSystemPromptTemplatePath(cwd: string, agentDir?: string): string {
	const projectTemplatePath = resolve(cwd, ".pi", "roles", TEMPLATE_FILE);
	if (existsSync(projectTemplatePath)) return projectTemplatePath;

	const resolvedAgentDir = agentDir ?? process.env.PI_CODING_AGENT_DIR;
	if (resolvedAgentDir) {
		const agentTemplatePath = resolve(resolvedAgentDir, "roles", TEMPLATE_FILE);
		if (existsSync(agentTemplatePath)) return agentTemplatePath;
	}

	return bundledTemplatePath;
}

export function loadSystemPromptTemplate(cwd: string, agentDir?: string): string {
	const templatePath = resolveSystemPromptTemplatePath(cwd, agentDir);
	const cached = templateCache.get(templatePath);
	if (cached !== undefined) return cached;

	const template = readFileSync(templatePath, "utf8");
	templateCache.set(templatePath, template);
	return template;
}

export function invalidateSystemPromptTemplateCache(): void {
	templateCache.clear();
}
