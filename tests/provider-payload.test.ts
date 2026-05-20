import assert from "node:assert/strict";
import { applyRoleTemperatureToPayload } from "../src/policy.js";

const blacklisted = applyRoleTemperatureToPayload(
	{
		provider: "openai-codex",
		modelId: "gpt-5.5",
		blacklist: ["openai-codex/*"],
		roleTemperature: 0.4,
	},
	{
		temperature: 0.2,
		generationConfig: {
			temperature: 0.2,
			topP: 0.9,
		},
		instructions: "keep me",
	},
) as Record<string, unknown>;

assert.equal(blacklisted.temperature, undefined, "blacklisted payloads must strip top-level temperature even if it already existed");
assert.deepEqual(blacklisted.generationConfig, { topP: 0.9 }, "blacklisted payloads must strip nested generationConfig.temperature and keep other keys");
assert.equal(blacklisted.instructions, "keep me");

const allowed = applyRoleTemperatureToPayload(
	{
		provider: "anthropic",
		modelId: "claude-sonnet-4-5",
		blacklist: ["openai-codex/*"],
		roleTemperature: 0.35,
	},
	{
		generationConfig: {
			topP: 0.9,
		},
	},
) as Record<string, unknown>;

assert.equal(allowed.temperature, 0.35);
assert.deepEqual(allowed.generationConfig, { topP: 0.9, temperature: 0.35 });

const inherit = applyRoleTemperatureToPayload(
	{
		provider: "anthropic",
		modelId: "claude-sonnet-4-5",
		blacklist: ["openai-codex/*"],
		roleTemperature: undefined,
	},
	{ temperature: 0.1 },
) as Record<string, unknown>;
assert.equal(inherit.temperature, 0.1, "when the role does not override temperature, payload should stay untouched");

console.log("provider payload tests passed");
